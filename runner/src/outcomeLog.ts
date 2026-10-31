// The outcome log: one file per landed ticket, in a folder per spec, each holding that ticket's one-row table.
// WrapUp.ts writes and commits the file; a fact nobody computed or passed is written `unrecorded`, never guessed.

import { join } from "node:path";

import type { IssueRef } from "./IssueWorkspaces.ts";

export const unrecorded = "unrecorded";

const columns = [
  "Issue",
  "Pair",
  "Account",
  "Files changed",
  "Peak context",
  "Result",
  "Proposals",
  "Review rounds",
  "Retries",
  "Duration",
  "Cost (API-equivalent)",
  "Review cost",
  "What review caught",
  "Session ids",
] as const;

type Column = (typeof columns)[number];

// The columns an older row has that today's doesn't; its Defers is today's Proposals.
const olderColumns = ["Triage cost", "Limit used"] as const;
const currentColumnByOlder: Record<string, Column> = { Defers: "Proposals" };

export type WrittenColumn = Column | (typeof olderColumns)[number];

// Who resolve's Fixes were made by; `skipped` is a ticket that needed only GitHub writes, so review had no diff to read.
export type ReviewFixes = "none" | "implementer" | "fresh" | "skipped";

export interface OutcomeFacts {
  reviewFixes?: ReviewFixes;
  whatReviewCaught?: string;
  proposals?: number;
  // The Halt's kind, when the ticket halted before it passed.
  halt?: string;
  reviewRounds?: number;
  retries?: number;
  pair?: string;
  account?: string;
  // Each implementer session's peak, in order; resolver sessions are left out.
  peakContext?: number[];
  durationMinutes?: number;
  // The implementer sessions, handoffs included.
  costUsd?: number;
  // The review and resolve sessions.
  reviewCostUsd?: number;
  sessionIds?: string[];
}

export interface OutcomeRow {
  issue: IssueRef;
  spec: IssueRef;
  githubOwner: string;
  filesChanged: number;
  facts: OutcomeFacts;
}

export function outcomePathOf(
  outcomeFolder: string,
  { issue, spec }: Pick<OutcomeRow, "issue" | "spec">,
): string {
  return join(outcomeFolder, labelOf(spec, "-"), `${labelOf(issue, "-")}.md`);
}

export function outcomeFileOf(row: OutcomeRow): string {
  const { issue, spec, githubOwner } = row;
  const specUrl = `https://github.com/${githubOwner}/${spec.repo}/issues/${spec.number}`;
  return [
    `# ${labelOf(issue, "#")} outcome`,
    "",
    `Spec: [${labelOf(spec, "#")}](${specUrl})`,
    "",
    tableLine(columns),
    tableLine(columns.map(() => "---")),
    tableLine(cellsOf(row)),
    "",
  ].join("\n");
}

export function outcomeCommitMessage(row: OutcomeRow): string {
  const { issue, filesChanged, facts } = row;
  return `Record the #${issue.number} outcome: ${facts.pair ?? unrecorded}, ${filesChanged} files, ${peakContextOf(facts)}, ${resultPhraseOf(facts)}.`;
}

export function peakContextOf({ peakContext }: OutcomeFacts): string {
  if (peakContext === undefined || peakContext.length === 0) return unrecorded;
  return peakContext.map(kiloOf).join(" → ");
}

export function kiloOf(tokens: number): string {
  return `${Math.round(tokens / 1000)}K`;
}

// A written row file's cells by column, an older row's read under today's column names; a column no row format has is left out.
export function writtenCellsOf(file: string): Map<WrittenColumn, string> {
  const lines = file.split("\n").filter((line) => line.startsWith("| "));
  const [header = "", , row = ""] = lines;
  const cells = cellsOfLine(row);
  return cellsOfLine(header).reduce((byColumn, written, index) => {
    const column = writtenColumnOf(written);
    if (column !== undefined) byColumn.set(column, cells[index] ?? "");
    return byColumn;
  }, new Map<WrittenColumn, string>());
}

function writtenColumnOf(written: string): WrittenColumn | undefined {
  const current = currentColumnByOlder[written];
  if (current !== undefined) return current;
  return [...columns, ...olderColumns].find((column) => column === written);
}

function cellsOfLine(line: string): string[] {
  return line.slice(2, -2).split(/ (?<!\\)\| /);
}

// A written row file with each `unrecorded` cell filled from the transcript fact `facts` defines; every other cell is
// kept as written.
export function withUnrecordedTranscriptCells(
  file: string,
  facts: OutcomeFacts,
): string {
  const fresh = transcriptCellsOf(facts);
  const lines = file.split("\n");
  const rowIndex = lines.findLastIndex((line) => line.startsWith("| "));
  const cells = cellsOfLine(lines[rowIndex] ?? "").map((cell, index) => {
    if (cell !== unrecorded) return cell;
    const column = columns[index];
    const value = column === undefined ? undefined : fresh[column];
    return value ?? cell;
  });
  lines[rowIndex] = `| ${cells.join(" | ")} |`;
  return lines.join("\n");
}

function transcriptCellsOf(
  facts: OutcomeFacts,
): Partial<Record<Column, string>> {
  const cells: Partial<Record<Column, string>> = {};
  if (facts.pair !== undefined) cells.Pair = facts.pair;
  if (facts.account !== undefined) cells.Account = facts.account;
  if (facts.peakContext !== undefined) {
    cells["Peak context"] = peakContextOf(facts);
  }
  if (facts.durationMinutes !== undefined) {
    cells.Duration = `${facts.durationMinutes} min`;
  }
  if (facts.costUsd !== undefined) {
    cells["Cost (API-equivalent)"] = dollarsOf(facts.costUsd);
  }
  if (facts.reviewCostUsd !== undefined) {
    cells["Review cost"] = dollarsOf(facts.reviewCostUsd);
  }
  if (facts.sessionIds !== undefined) {
    cells["Session ids"] = facts.sessionIds.join(", ");
  }
  return cells;
}

function cellsOf({ issue, filesChanged, facts }: OutcomeRow): string[] {
  return [
    `#${issue.number}`,
    facts.pair ?? unrecorded,
    facts.account ?? unrecorded,
    String(filesChanged),
    peakContextOf(facts),
    resultOf(facts),
    String(facts.proposals ?? 0),
    String(facts.reviewRounds ?? 1),
    String(facts.retries ?? 0),
    facts.durationMinutes === undefined
      ? unrecorded
      : `${facts.durationMinutes} min`,
    dollarsOf(facts.costUsd),
    dollarsOf(facts.reviewCostUsd),
    whatReviewCaughtCellOf(facts),
    facts.sessionIds?.join(", ") ?? unrecorded,
  ];
}

function resultOf({ halt, reviewFixes }: OutcomeFacts): string {
  if (halt !== undefined) return `Halted then passed (${halt})`;
  return reviewFixes === undefined
    ? unrecorded
    : resultByReviewFixes[reviewFixes];
}

const resultByReviewFixes: Record<ReviewFixes, string> = {
  none: "Pass",
  implementer: "Fix (resumed implementer)",
  fresh: "Fix (fresh resolver)",
  skipped: "skipped (no code)",
};

function resultPhraseOf({ halt, reviewFixes }: OutcomeFacts): string {
  if (halt !== undefined) return "halted then passed";
  if (reviewFixes === undefined) return "result unrecorded";
  return resultPhraseByReviewFixes[reviewFixes];
}

const resultPhraseByReviewFixes: Record<ReviewFixes, string> = {
  none: "first-try pass",
  implementer: "fixed after review by the resumed implementer",
  fresh: "fixed after review by a fresh resolver",
  skipped: "review skipped (no code)",
};

function whatReviewCaughtCellOf({
  whatReviewCaught,
  reviewFixes,
}: OutcomeFacts): string {
  if (whatReviewCaught !== undefined) return whatReviewCaught;
  return reviewFixes === "none" || reviewFixes === "skipped" ? "—" : unrecorded;
}

export function dollarsOf(usd: number | undefined): string {
  return usd === undefined ? unrecorded : `$${usd.toFixed(2)}`;
}

export function labelOf({ repo, number }: IssueRef, separator: string): string {
  return `${repo}${separator}${number}`;
}

function tableLine(cells: readonly string[]): string {
  return `| ${cells.map((cell) => cell.replaceAll("|", "\\|")).join(" | ")} |`;
}
