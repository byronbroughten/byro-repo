// The outcome log: one file per landed ticket, in a folder per spec, each holding that ticket's one-row table.
// WrapUp/LogRowCommitter.ts writes and commits the file; a fact nobody computed or passed is written `unrecorded`, never guessed.

import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { basename, dirname, join } from "node:path";

import type { IssueRef } from "./IssueWorkspaces.ts";
import type { WorkflowName } from "./Workflow.ts";

export const unrecorded = "unrecorded";

const columns = [
  "Issue",
  "Workflow",
  "Pair",
  "Account",
  "Files changed",
  "Estimate",
  "Peak context",
  "Result",
  "Proposals",
  "Review rounds",
  "Retries",
  "Limit resumes",
  "Duration",
  "Cost (API-equivalent)",
  "Review cost",
  "What review caught",
  "Session ids",
  "Landed",
] as const;

type Column = (typeof columns)[number];

// The columns an older row has that today's doesn't; its Defers is today's Proposals.
const olderColumns = ["Triage cost", "Limit used"] as const;
const currentColumnByOlder: Record<string, Column> = { Defers: "Proposals" };

export type WrittenColumn = Column | (typeof olderColumns)[number];

// Who resolve's Fixes were made by; `skipped` is a ticket that needed only GitHub writes, so review had no diff to read.
export type ReviewFixes = "none" | "implementer" | "fresh" | "skipped";

// A row written before the Workflow column, or by a wrap-up older than it, was a code ticket's.
export const olderRowWorkflow: WorkflowName = "code";

export interface OutcomeFacts {
  reviewFixes?: ReviewFixes;
  whatReviewCaught?: string;
  proposals?: number;
  // The Halt's kind, when the ticket halted before it passed.
  halt?: string;
  reviewRounds?: number;
  retries?: number;
  // Relaunches of a step a usage limit cut off; each starts on a cold prompt cache when its limit wait outlasts the cache.
  limitResumes?: number;
  pair?: string;
  account?: string;
  // The `~NK` ending the ticket's Model fit reason; a ticket without one gets a blank cell, as it was never estimated.
  estimate?: string;
  // Each implementer session's peak, in order; resolver sessions are left out.
  peakContext?: number[];
  durationMinutes?: number;
  // The implementer sessions, handoffs included, up to the review's cut in one the review or its resolve resumed.
  costUsd?: number;
  // The review and resolve sessions, and of an implementer session the review resumed, what follows that cut.
  reviewCostUsd?: number;
  sessionIds?: string[];
}

export interface OutcomeRow {
  issue: IssueRef;
  spec: IssueRef;
  githubOwner: string;
  workflow: WorkflowName;
  filesChanged: number;
  // Kept in the row, not read from git, so it survives the log leaving git.
  landedAt: Date;
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
  return rowFileOf({ issue, spec, specUrl }, columns, cellsOf(row));
}

/** A written row file read back: its tickets, its spec's link and its cells by column, a `\|` in a cell read as `|`. */
export interface WrittenRow {
  issue: IssueRef;
  spec: IssueRef;
  specUrl: string;
  cells: Map<WrittenColumn, string>;
}

export const writtenColumns: readonly WrittenColumn[] = [
  ...columns,
  ...olderColumns,
];

/** A row file as read from disk. */
export interface OutcomeRowFile {
  // Relative to the outcome folder: `<spec repo>-<spec n>/<repo>-<n>.md`.
  path: string;
  text: string;
}

/** The row files in each spec's folder, by path; none when no landing has written a row yet. */
export function rowFilesIn(outcomeFolder: string): OutcomeRowFile[] {
  if (!existsSync(outcomeFolder)) return [];
  // A file beside the spec folders, an older log's, isn't a row.
  return readdirSync(outcomeFolder, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort()
    .flatMap((folder) =>
      readdirSync(join(outcomeFolder, folder))
        .filter((name) => name.endsWith(".md"))
        .sort()
        .map((name) => {
          const path = `${folder}/${name}`;
          return {
            path,
            text: readFileSync(join(outcomeFolder, path), "utf8"),
          };
        }),
    );
}

/** Each row file's row, its ticket read from its file name. */
export function writtenRowsIn(outcomeFolder: string): WrittenRow[] {
  return rowFilesIn(outcomeFolder).map(({ path, text }) =>
    writtenRowOf(issueOfLabel(basename(path, ".md")), text),
  );
}

/** A written row's file label, `<repo>-<n>`, spec link and cells by column, put back together. */
interface WrittenRowParts {
  label: string;
  specUrl: string;
  cells: Map<string, string>;
}

export function writtenRowOfParts({
  label,
  specUrl,
  cells,
}: WrittenRowParts): WrittenRow {
  const [, repo, number] = /\/([^/]+)\/issues\/(\d+)$/.exec(specUrl) ?? [];
  if (repo === undefined) {
    throw new Error(
      `The ${label} row's spec link "${specUrl}" isn't an issue URL.`,
    );
  }
  return {
    issue: issueOfLabel(label),
    spec: { repo, number: Number(number) },
    specUrl,
    cells: new Map(
      writtenColumns.map((column): [WrittenColumn, string] => [
        column,
        cells.get(column) ?? "",
      ]),
    ),
  };
}

/** Writes a read row back to its file, leaving a file already there alone; whether it wrote one. */
export function restoreOutcomeRow(
  outcomeFolder: string,
  row: WrittenRow,
): boolean {
  const path = outcomePathOf(outcomeFolder, row);
  if (existsSync(path)) return false;
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, writtenFileOf(row));
  return true;
}

function issueOfLabel(label: string): IssueRef {
  const [, repo, number] = /^(.+)-(\d+)$/.exec(label) ?? [];
  if (repo === undefined) {
    throw new Error(`The outcome row label "${label}" isn't <repo>-<n>.`);
  }
  return { repo, number: Number(number) };
}

/** The row file `file` holds for `issue`, which its file name, not its table, names in full. */
export function writtenRowOf(issue: IssueRef, file: string): WrittenRow {
  const [, specRepo, specNumber, specUrl] =
    /^Spec: \[(.+)#(\d+)\]\((.*)\)$/m.exec(file) ?? [];
  if (specRepo === undefined || specUrl === undefined) {
    throw new Error(`The ${labelOf(issue, "#")} row file has no Spec line.`);
  }
  const cells = new Map(
    [...writtenCellsOf(file)].map(([column, cell]) => [
      column,
      cell.replaceAll("\\|", "|"),
    ]),
  );
  return {
    issue,
    spec: { repo: specRepo, number: Number(specNumber) },
    specUrl,
    cells,
  };
}

/** The file holding a read row: today's columns, and each older one only where its cell isn't blank. */
export function writtenFileOf({ cells, ...link }: WrittenRow): string {
  const header = writtenColumns.filter(
    (column) =>
      columns.some((current) => current === column) ||
      (cells.get(column) ?? "") !== "",
  );
  return rowFileOf(
    link,
    header,
    header.map((column) => cells.get(column) ?? ""),
  );
}

function rowFileOf(
  { issue, spec, specUrl }: Omit<WrittenRow, "cells">,
  header: readonly string[],
  cells: readonly string[],
): string {
  return [
    `# ${labelOf(issue, "#")} outcome`,
    "",
    `Spec: [${labelOf(spec, "#")}](${specUrl})`,
    "",
    tableLine(header),
    tableLine(header.map(() => "---")),
    tableLine(cells),
    "",
  ].join("\n");
}

export function peakContextOf({ peakContext }: OutcomeFacts): string {
  if (peakContext === undefined || peakContext.length === 0) return unrecorded;
  return peakContext.map(kiloOf).join(" → ");
}

export function kiloOf(tokens: number): string {
  return `${Math.round(tokens / 1000)}K`;
}

// A written row file's cells by column, an older row's read under today's column names and as a code row.
export function writtenCellsOf(file: string): Map<WrittenColumn, string> {
  const lines = file.split("\n").filter((line) => line.startsWith("| "));
  const [header = "", , row = ""] = lines;
  const cells = cellsOfLine(row);
  return cellsOfLine(header).reduce(
    (byColumn, written, index) => {
      const column = writtenColumnOf(written);
      if (column !== undefined) byColumn.set(column, cells[index] ?? "");
      return byColumn;
    },
    new Map<WrittenColumn, string>([["Workflow", olderRowWorkflow]]),
  );
}

function writtenColumnOf(written: string): WrittenColumn | undefined {
  const current = currentColumnByOlder[written];
  if (current !== undefined) return current;
  return writtenColumns.find((column) => column === written);
}

function cellsOfLine(line: string): string[] {
  return line.slice(2, -2).split(/ (?<!\\)\| /);
}

function cellsOf({
  issue,
  workflow,
  filesChanged,
  landedAt,
  facts,
}: OutcomeRow): string[] {
  return [
    `#${issue.number}`,
    workflow,
    facts.pair ?? unrecorded,
    facts.account ?? unrecorded,
    String(filesChanged),
    facts.estimate ?? "",
    peakContextOf(facts),
    resultOf(facts),
    String(facts.proposals ?? 0),
    String(facts.reviewRounds ?? 1),
    String(facts.retries ?? 0),
    String(facts.limitResumes ?? 0),
    facts.durationMinutes === undefined
      ? unrecorded
      : `${facts.durationMinutes} min`,
    dollarsOf(facts.costUsd),
    dollarsOf(facts.reviewCostUsd),
    whatReviewCaughtCellOf(facts),
    facts.sessionIds?.join(", ") ?? unrecorded,
    landedAt.toISOString(),
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
