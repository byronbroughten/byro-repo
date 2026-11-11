// A drafting ticket's checks, run after resolve: the overlap command over the ticket's scope of the Agent draft, red on
// any hit its review didn't dismiss, then the spec's length limit on a whole-scope ticket. Facts and style stay with review.
// The scope is the agent Sections the implement record drafted, or every agent Section on a final pass; the developer's
// Sections are never checked for overlap. pieceWorkflow.ts registers it as its ticket checks, and
// ../../SpecRun/TicketLander/TicketChecker.ts runs it, sending a red one to redChecksStep.ts before a Failure Halt.

import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { commandLabelOf } from "../../failureText.ts";
import { runCollecting } from "../../runCollecting.ts";
import type { Command } from "../../runKnobs.ts";
import type { TicketState } from "../../SpecRun/runState.ts";
import type { DismissedOverlap, DraftedRecord } from "../../stepRecords.ts";
import { ticketSectionOf } from "../../ticketSections.ts";
import type { TicketChecksInput } from "../../Workflow.ts";
import { agentDraft, type DraftSection } from "./agentDraft.ts";
import { draftingScope } from "./draftingScope.ts";
import { passagesFolderIn } from "./implementStep.ts";

const patterns = {
  // The Form field's fixed line, as the spec's Trusted text holds it.
  lengthLine: /^Length: (\d+) words$/m,
  // A hit's first line in the overlap command's report: its number, then the shared text in quotes.
  hitLine: /^\d+\. "(.+)" \(/,
  quotedText: /"(.+)"/,
  word: /[\p{L}\p{N}]+(?:['’-][\p{L}\p{N}]+)*/gu,
} as const;

const formHeading = "## Form";

export interface PieceChecksInput extends TicketChecksInput {
  overlapCommand: Command;
  // The Agent draft as the ticket's branch holds it.
  draft: string;
}

export interface DraftScope {
  sections: DraftSection[];
  // Every Section of the Agent draft, so the spec's length limit is the ticket's to meet.
  isWhole: boolean;
}

interface OverlapHit {
  // The text the Deliverable shares with a passage.
  sharedText: string;
  // The hit as the report printed it, its Deliverable and passage lines included.
  lines: string[];
}

export const pieceChecks = {
  // The failures, each its own paragraph; undefined when green.
  async failureOf(input: PieceChecksInput): Promise<string | undefined> {
    const sections = agentDraft.sectionsOf(input.draft);
    const scope = pieceChecks.scopeOf(sections, input);
    const failures = [
      await overlapFailureOf(input, scope),
      scope.isWhole ? lengthFailureOf(input.spec.body, sections) : undefined,
    ].filter((failure) => failure !== undefined);
    return failures.length === 0 ? undefined : failures.join("\n\n");
  },

  scopeOf(
    sections: DraftSection[],
    { ticket, state }: Pick<TicketChecksInput, "ticket" | "state">,
  ): DraftScope {
    const agentSections = sections.filter(({ author }) => author === "agent");
    if (draftingScope.isFinalPass(ticket.labels)) {
      return { sections: agentSections, isWhole: true };
    }
    const drafted = sectionsDraftedOf(state);
    const inScope = agentSections.filter(({ heading }) =>
      drafted.includes(heading),
    );
    return { sections: inScope, isWhole: inScope.length === sections.length };
  },

  // The spec's word limit, undefined when its Form field has no `Length:` line.
  lengthLimitOf(specBody: string): number | undefined {
    const form = ticketSectionOf(specBody, formHeading) ?? "";
    const limit = patterns.lengthLine.exec(form)?.[1];
    return limit === undefined ? undefined : Number(limit);
  },

  // Over every Section's body, headings and author marks left out.
  wordCountOf(sections: DraftSection[]): number {
    return sections.reduce(
      (count, { markdown }) =>
        count + (markdown.match(patterns.word)?.length ?? 0),
      0,
    );
  },
};

function sectionsDraftedOf({ record }: TicketState): string[] {
  if (record?.status !== "committed" || !("sectionsDrafted" in record)) {
    return [];
  }
  return (record as DraftedRecord).sectionsDrafted;
}

// The scope's bodies go to the command as its Deliverable, so a hit in any other Section never shows.
async function overlapFailureOf(
  { overlapCommand, workspacePath, ticket, state }: PieceChecksInput,
  scope: DraftScope,
): Promise<string | undefined> {
  const label = commandLabelOf(overlapCommand);
  const passagesFolder = passagesFolderIn(workspacePath, ticket.issue);
  mkdirSync(passagesFolder, { recursive: true });
  const folder = mkdtempSync(join(tmpdir(), "piece-checks-"));
  try {
    const deliverable = join(folder, "scope.md");
    writeFileSync(
      deliverable,
      scope.sections.map(({ markdown }) => markdown).join("\n"),
    );
    const [file, ...args] = overlapCommand;
    const { isOk, output } = await runCollecting(
      file,
      [...args, "--deliverable", deliverable, "--passages", passagesFolder],
      { cwd: workspacePath },
    );
    if (!isOk) return `${label} failed:\n${output}`;
    const dismissed = (state.dismissedOverlaps ?? []).map(dismissedTextOf);
    const unjudged = hitsOf(output).filter(
      ({ sharedText }) => !dismissed.includes(sharedText.toLowerCase()),
    );
    if (unjudged.length === 0) return undefined;
    return [
      `${label} found ${unjudged.length} overlap hit(s) in the ticket's Sections that review didn't dismiss:`,
      ...unjudged.flatMap(({ lines }) => lines),
    ].join("\n");
  } finally {
    rmSync(folder, { recursive: true, force: true });
  }
}

function hitsOf(report: string): OverlapHit[] {
  return report.split("\n").reduce<OverlapHit[]>((hits, line) => {
    const sharedText = patterns.hitLine.exec(line)?.[1];
    if (sharedText !== undefined) {
      hits.push({ sharedText, lines: [line] });
    } else if (line.startsWith("   ")) {
      hits.at(-1)?.lines.push(line);
    }
    return hits;
  }, []);
}

// A review may give the hit's whole line, its quoted text or the bare text.
function dismissedTextOf({ hit }: DismissedOverlap): string {
  const text = hit.trim();
  const sharedText =
    patterns.hitLine.exec(text)?.[1] ?? patterns.quotedText.exec(text)?.[1];
  return (sharedText ?? text).toLowerCase();
}

function lengthFailureOf(
  specBody: string,
  sections: DraftSection[],
): string | undefined {
  const limit = pieceChecks.lengthLimitOf(specBody);
  if (limit === undefined) return undefined;
  const count = pieceChecks.wordCountOf(sections);
  if (count <= limit) return undefined;
  return `The Agent draft's Sections are ${count} words, over the ${limit} words the spec's \`Length:\` line allows.`;
}
