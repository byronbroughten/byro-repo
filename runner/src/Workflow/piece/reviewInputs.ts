// The inputs `/review-piece` copies word for word, written before a drafting ticket's review launches, run or session brief:
// the spec's Reader, Outline and Length limit, the research tickets' Unverified sections, the overlap command's report
// over the Agent draft and the Style file. Each goes to its own file in the review-inputs folder, uncommitted, as the
// passages folder does; a field the spec lacks is named as absent instead. The fact list stays the review's to build.
// pieceWorkflow.ts registers it as its review rules' supplied inputs, and reviewStep.ts names each file in the prompt.

import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { commandLabelOf } from "../../failureText.ts";
import type { IssueRef } from "../../IssueWorkspaces.ts";
import type { Command } from "../../runKnobs.ts";
import type { TrackedIssue } from "../../SpecRun/runState.ts";
import { ticketSectionOf } from "../../ticketSections.ts";
import type {
  ReviewInputsContext,
  SuppliedInput,
  WrittenInput,
} from "../../Workflow.ts";
import { passagesFolderIn } from "./implementStep.ts";
import { pieceChecks } from "./pieceChecks.ts";

const headings = {
  reader: "## Reader",
  outline: "## Outline",
  style: "## Style",
  form: "## Form",
  order: "## Order",
  unverified: "## Unverified",
} as const;

const patterns = {
  // The Style field's first line, as a piece spec records its Axes.
  axesLine: /^Evidence: (\S+) · Formality: (\S+)$/,
  academicLine: /^Academic$/,
} as const;

// Empty but for this note: which names the Piece can't reword is the review's judgment, so it adds them and reruns.
const allowNote =
  "# One proper name or fixed term per line, which the Piece can't reword; the runner lists none.\n";

export interface ReviewInputsRun extends ReviewInputsContext {
  overlapCommand: Command;
  // The Agent draft's path in the spec's clone.
  draftPath: string;
  isResearch(ticket: TrackedIssue): boolean;
}

interface StyleAxes {
  evidence: string;
  formality: string;
  isAcademic: boolean;
}

export const reviewInputs = {
  // In `/review-piece`'s order: Reader, Unverified, Outline, Length limit, Overlap and its allow file, Style.
  async writtenOf(run: ReviewInputsRun): Promise<SuppliedInput[]> {
    const folder = reviewInputsFolderIn(run.workspacePath, run.ticket);
    mkdirSync(folder, { recursive: true });
    const { body } = run.spec;
    const reader = fieldOf(body, headings.reader);
    const unverified = await unverifiedOf(run);
    const outline = fieldOf(body, headings.outline);
    const lengthLine = pieceChecks.lengthLineOf(body);
    const allow = writtenInputOf(folder, {
      name: "Overlap allow",
      file: "overlap-allow.txt",
      text: allowNote,
    });
    const overlap = writtenInputOf(folder, {
      name: "Overlap",
      file: "overlap.txt",
      text: await overlapReportOf(run, allow.path),
    });
    return [
      fieldInputOf(folder, {
        name: "Reader",
        file: "reader.md",
        text: reader,
        absence: absentFieldOf(headings.reader),
      }),
      fieldInputOf(folder, {
        name: "Unverified",
        file: "unverified.md",
        text: unverified,
        absence: "no research ticket's comment has an `## Unverified` section",
      }),
      fieldInputOf(folder, {
        name: "Outline",
        file: "outline.md",
        text: outline,
        absence: absentFieldOf(headings.outline),
      }),
      fieldInputOf(folder, {
        name: "Length limit",
        file: "length-limit.md",
        text: lengthLine === undefined ? undefined : `${lengthLine}\n`,
        absence: "the spec's Form field has no `Length:` line",
      }),
      overlap,
      allow,
      styleInputOf(folder, body),
    ];
  },
};

function reviewInputsFolderIn(
  workspacePath: string,
  { repo, number }: IssueRef,
): string {
  return join(workspacePath, ".runner", "review-inputs", `${repo}-${number}`);
}

interface InputFile {
  name: string;
  file: string;
  text: string;
}

interface FieldFile extends Omit<InputFile, "text"> {
  // Undefined when the spec lacks the field.
  text: string | undefined;
  absence: string;
}

function writtenInputOf(
  folder: string,
  { name, file, text }: InputFile,
): WrittenInput {
  const path = join(folder, file);
  writeFileSync(path, text);
  return { name, path };
}

function fieldInputOf(
  folder: string,
  { text, absence, ...input }: FieldFile,
): SuppliedInput {
  if (text === undefined) return { name: input.name, absence };
  return writtenInputOf(folder, { ...input, text });
}

function absentFieldOf(heading: string): string {
  return `the spec has no \`${heading}\` field`;
}

// A section's body, its heading line dropped, trimmed and ended with one newline; undefined when absent or empty.
function fieldOf(body: string, heading: string): string | undefined {
  const section = ticketSectionOf(body, heading);
  if (section === undefined) return undefined;
  const text = section.split("\n").slice(1).join("\n").trim();
  return text === "" ? undefined : `${text}\n`;
}

async function unverifiedOf(run: ReviewInputsRun): Promise<string | undefined> {
  const comments = await run.commentsOnTicketsOf(run.isResearch);
  const sections = comments.flatMap((comment) => {
    const section = fieldOf(comment, headings.unverified);
    return section === undefined ? [] : [section];
  });
  return sections.length === 0 ? undefined : sections.join("\n");
}

// Over the whole Agent draft, as `/review-piece` runs it; a failed run is written as the failure, for the review to note.
async function overlapReportOf(
  {
    overlapCommand,
    workspacePath,
    specClone,
    draftPath,
    ticket,
  }: ReviewInputsRun,
  allowFile: string,
): Promise<string> {
  const passagesFolder = passagesFolderIn(workspacePath, ticket);
  mkdirSync(passagesFolder, { recursive: true });
  const { isOk, output } = await pieceChecks.overlapReportOf({
    overlapCommand,
    workspacePath,
    deliverable: join(specClone, draftPath),
    passagesFolder,
    allowFile,
  });
  if (isOk) return output;
  return `${commandLabelOf(overlapCommand)} failed:\n${output}`;
}

// The Style file shape the Jev agent doc's style check names: the Axes lines, then the overrides, Form and Order verbatim.
function styleInputOf(folder: string, body: string): SuppliedInput {
  const style = fieldOf(body, headings.style);
  if (style === undefined) {
    return { name: "Style", absence: absentFieldOf(headings.style) };
  }
  const [axesLine = "", ...overrides] = style.split("\n");
  const axes = axesOf(axesLine);
  if (axes === undefined) {
    return {
      name: "Style",
      absence:
        "the spec's Style field doesn't open with its `Evidence: <value> · Formality: <value>` or `Academic` line",
    };
  }
  const subsections = [
    { heading: "### Form", text: fieldOf(body, headings.form) },
    { heading: "### Order", text: fieldOf(body, headings.order) },
  ].flatMap(({ heading, text }) =>
    text === undefined ? [] : [`${heading}\n\n${text}`],
  );
  const text = [
    axesLinesOf(axes),
    overridesOf(overrides.join("\n").trim()),
    ...subsections,
  ].join("\n");
  return writtenInputOf(folder, { name: "Style", file: "style.md", text });
}

function axesLinesOf({ evidence, formality, isAcademic }: StyleAxes): string {
  const academic = isAcademic ? "yes" : "no";
  return `Evidence: ${evidence}\nFormality: ${formality}\nAcademic: ${academic}\n`;
}

// The heading stays when the spec has no overrides, since the style check stops on a Style file without it.
function overridesOf(overrides: string): string {
  if (overrides === "") return "## Overrides\n";
  return `## Overrides\n\n${overrides}\n`;
}

function axesOf(line: string): StyleAxes | undefined {
  if (patterns.academicLine.test(line)) {
    return { evidence: "cited", formality: "formal", isAcademic: true };
  }
  const match = patterns.axesLine.exec(line);
  if (match === null) return undefined;
  const [, evidence = "", formality = ""] = match;
  return { evidence, formality, isAcademic: false };
}
