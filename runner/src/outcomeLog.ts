// The outcome log: one file per landed ticket, in a folder per spec, each holding that ticket's one-row table.
// WrapUp.ts writes and commits the file; a fact nobody computed or passed is written `unrecorded`, never guessed.

import { join } from "node:path";

import type { IssueRef } from "./IssueWorkspaces.ts";

const unrecorded = "unrecorded";

const columns = [
  "Issue",
  "Pair",
  "Account",
  "Files changed",
  "Peak context",
  "Result",
  "Defers",
  "Review rounds",
  "Retries",
  "Duration",
  "Cost (API-equivalent)",
  "Triage cost",
  "Limit used",
  "What review caught",
  "Session ids",
] as const;

// `skipped` is a ticket that needed only GitHub writes, so review had no diff to read.
export type ReviewFixes = "none" | "implementer" | "triage" | "skipped";

export interface OutcomeFacts {
  reviewFixes?: ReviewFixes;
  whatReviewCaught?: string;
  defers?: number;
  // The Halt's kind, when the ticket halted before it passed.
  halt?: string;
  reviewRounds?: number;
  retries?: number;
  pair?: string;
  account?: string;
  // Each implementer session's peak, in order; fixer sessions are left out.
  peakContext?: number[];
  durationMinutes?: number;
  costUsd?: number;
  triageCostUsd?: number;
  limitUsed?: string;
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
  return peakContext.map((peak) => `${Math.round(peak / 1000)}K`).join(" → ");
}

function cellsOf({ issue, filesChanged, facts }: OutcomeRow): string[] {
  return [
    `#${issue.number}`,
    facts.pair ?? unrecorded,
    facts.account ?? unrecorded,
    String(filesChanged),
    peakContextOf(facts),
    resultOf(facts),
    String(facts.defers ?? 0),
    String(facts.reviewRounds ?? 1),
    String(facts.retries ?? 0),
    facts.durationMinutes === undefined
      ? unrecorded
      : `${facts.durationMinutes} min`,
    dollarsOf(facts.costUsd),
    dollarsOf(facts.triageCostUsd),
    facts.limitUsed ?? unrecorded,
    whatReviewCaughtOf(facts),
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
  implementer: "Fix",
  triage: "Triage fix",
  skipped: "skipped (no code)",
};

function resultPhraseOf({ halt, reviewFixes }: OutcomeFacts): string {
  if (halt !== undefined) return "halted then passed";
  if (reviewFixes === undefined) return "result unrecorded";
  return resultPhraseByReviewFixes[reviewFixes];
}

const resultPhraseByReviewFixes: Record<ReviewFixes, string> = {
  none: "first-try pass",
  implementer: "fixed after review",
  triage: "fixed after review",
  skipped: "review skipped (no code)",
};

function whatReviewCaughtOf({
  whatReviewCaught,
  reviewFixes,
}: OutcomeFacts): string {
  if (whatReviewCaught !== undefined) return whatReviewCaught;
  return reviewFixes === "none" || reviewFixes === "skipped" ? "—" : unrecorded;
}

function dollarsOf(usd: number | undefined): string {
  return usd === undefined ? unrecorded : `$${usd.toFixed(2)}`;
}

function labelOf({ repo, number }: IssueRef, separator: string): string {
  return `${repo}${separator}${number}`;
}

function tableLine(cells: readonly string[]): string {
  return `| ${cells.map((cell) => cell.replaceAll("|", "\\|")).join(" | ")} |`;
}
