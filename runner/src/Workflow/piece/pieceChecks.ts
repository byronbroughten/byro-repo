// A drafting ticket's checks, run after resolve: the overlap command over the ticket's scope of the Agent draft, red on
// any hit its review didn't dismiss, then the spec's length limit on a whole-scope ticket. Facts and style stay with review.
// The scope is the agent Sections the implement record drafted, or every agent Section on a final pass; the developer's
// Sections are never checked for overlap. pieceWorkflow.ts registers it as its ticket checks, and
// ../../SpecRun/TicketLander/TicketChecker.ts runs it, sending a red one to redChecksStep.ts before a Failure Halt.
// reviewInputs.ts reuses its overlap report and `Length:` line for the review's supplied inputs.

import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { commandLabelOf } from "../../failureText.ts";
import type { IssueRef } from "../../IssueWorkspaces.ts";
import { markdownSectionOf } from "../../markdownSections.ts";
import { runCollecting } from "../../runCollecting.ts";
import type { Command } from "../../runKnobs.ts";
import type { TicketState } from "../../SpecRun/runState.ts";
import type { DismissedOverlap, DraftedRecord } from "../../stepRecords.ts";
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

export const formHeading = "## Form";

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

interface OverlapRun {
  overlapCommand: Command;
  specRepo: string;
  passagesFolder: string;
}

export interface OverlapReportRun {
  overlapCommand: Command;
  workspacePath: string;
  ticket: IssueRef;
  deliverable: string;
  // One proper name or fixed term per line; none passed when unset.
  allowFile?: string;
}

export interface OverlapReport {
  isOk: boolean;
  // The command's report, or on a failed run its failure as the checks word it.
  text: string;
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
      scope.isWhole
        ? pieceChecks.lengthFailureOf(input.spec.body, sections)
        : undefined,
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
    const inScope = agentSections.filter(({ path }) => drafted.includes(path));
    return {
      sections: inScope,
      isWhole: inScope.length === sections.filter(isScopeable).length,
    };
  },

  // The spec's word limit, undefined when its Form field has no `Length:` line.
  lengthLimitOf(specBody: string): number | undefined {
    const limit = lengthMatchOf(specBody)?.[1];
    return limit === undefined ? undefined : Number(limit);
  },

  // The Form field's `Length:` line as the spec has it, undefined when it has none.
  lengthLineOf(specBody: string): string | undefined {
    return lengthMatchOf(specBody)?.[0];
  },

  // Over every Section's body, headings and author marks left out.
  wordCountOf(sections: DraftSection[]): number {
    return sections.reduce(
      (count, { markdown }) =>
        count + (markdown.match(patterns.word)?.length ?? 0),
      0,
    );
  },

  // The overlap failure's first line, naming each Section in the scope by its full heading path.
  overlapHeadlineOf(
    commandLabel: string,
    hitCount: number,
    scope: DraftSection[],
  ): string {
    return `${commandLabel} found ${hitCount} overlap hit(s) in the ticket's Sections (${pathsTextOf(scope)}) that review didn't dismiss:`;
  },

  // Undefined when the draft is within the spec's limit or the spec sets none; else each Section's words by full heading path.
  lengthFailureOf(
    specBody: string,
    sections: DraftSection[],
  ): string | undefined {
    const limit = pieceChecks.lengthLimitOf(specBody);
    if (limit === undefined) return undefined;
    const count = pieceChecks.wordCountOf(sections);
    if (count <= limit) return undefined;
    const perSection = sections
      .map((section) => ({
        path: section.path,
        words: pieceChecks.wordCountOf([section]),
      }))
      .filter(({ words }) => words > 0)
      .map(({ path, words }) => `"${path}": ${words}`)
      .join(", ");
    return `The Agent draft's Sections are ${count} words (${perSection}), over the ${limit} words the spec's \`Length:\` line allows.`;
  },

  // The overlap command's report on a Deliverable file over the ticket's passages folder, run from the workspace root.
  async overlapReportOf({
    overlapCommand,
    workspacePath,
    ticket,
    deliverable,
    allowFile,
  }: OverlapReportRun): Promise<OverlapReport> {
    const passagesFolder = passagesFolderIn(workspacePath, ticket);
    mkdirSync(passagesFolder, { recursive: true });
    const [file, ...args] = overlapCommand;
    const allow = allowFile === undefined ? [] : ["--allow", allowFile];
    const { isOk, output } = await runCollecting(
      file,
      [
        ...args,
        "--deliverable",
        deliverable,
        "--passages",
        passagesFolder,
        ...allow,
      ],
      { cwd: workspacePath },
    );
    if (isOk) return { isOk, text: output };
    return {
      isOk,
      text: `${commandLabelOf(overlapCommand)} failed:\n${output}`,
    };
  },

  overlapRunOf({
    overlapCommand,
    specRepo,
    passagesFolder,
  }: OverlapRun): string {
    return `${commandLabelOf(overlapCommand)} --deliverable <the Agent draft's path in the ${specRepo} clone> --passages ${passagesFolder}`;
  },

  // Fits after "Fix every hit", as the prompts word which hits are the ticket's.
  overlapFixLineOf(hits: string): string {
    return `Fix every hit ${hits}, then rerun it; a hit in any other Section isn't this ticket's.`;
  },
};

function lengthMatchOf(specBody: string): RegExpExecArray | null {
  return patterns.lengthLine.exec(
    markdownSectionOf(specBody, formHeading) ?? "",
  );
}

function sectionsDraftedOf({ record }: TicketState): string[] {
  if (record?.status !== "committed" || !("sectionsDrafted" in record)) {
    return [];
  }
  return (record as DraftedRecord).sectionsDrafted;
}

// An empty developer Section, as every H1 with no text of its own holds, adds no words, so leaving it out never makes a scope partial.
function isScopeable({ author, markdown }: DraftSection): boolean {
  return author === "agent" || markdown.trim() !== "";
}

// The scope's bodies go to the command as its Deliverable, so a hit in any other Section never shows.
async function overlapFailureOf(
  { overlapCommand, workspacePath, ticket, state }: PieceChecksInput,
  scope: DraftScope,
): Promise<string | undefined> {
  const folder = mkdtempSync(join(tmpdir(), "piece-checks-"));
  try {
    const deliverable = join(folder, "scope.md");
    writeFileSync(
      deliverable,
      scope.sections.map(({ markdown }) => markdown).join("\n"),
    );
    const report = await pieceChecks.overlapReportOf({
      overlapCommand,
      workspacePath,
      ticket: ticket.issue,
      deliverable,
    });
    if (!report.isOk) return report.text;
    const dismissed = (state.dismissedOverlaps ?? []).map(dismissedTextOf);
    const unjudged = hitsOf(report.text).filter(
      ({ sharedText }) => !dismissed.includes(sharedText.toLowerCase()),
    );
    if (unjudged.length === 0) return undefined;
    return [
      pieceChecks.overlapHeadlineOf(
        commandLabelOf(overlapCommand),
        unjudged.length,
        scope.sections,
      ),
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

function pathsTextOf(sections: DraftSection[]): string {
  return sections.map(({ path }) => `"${path}"`).join(", ");
}
