// The outcome summary behind `npm run outcome:summary`: picks spec sections of the outcome log and reports what `/mine-outcomes` reads in place of the rows.
// Row files come in as text with each one's landing date, and Model fit and transcripts as lookups; scripts/runner/outcomeSummary.ts gathers them.
// The outlier rules and older column names are .claude/skills/mine-outcomes/SKILL.md's; the columns themselves are outcomeLog.ts's.

import type { IssueRef } from "./IssueWorkspaces.ts";

export interface OutcomeRowFile {
  // Relative to the outcome folder: `<spec repo>-<spec n>/<repo>-<n>.md`, or the legacy log's own name, which has no folder.
  path: string;
  text: string;
  landedAt: Date;
}

export type SectionSelection =
  { section: string } | { recent: number } | { all: true };

export interface OutcomeSummaryInput {
  rowFiles: OutcomeRowFile[];
  selection: SectionSelection;
  ticketBudget: number;
  // The ticket's Model fit pair line and reason, or why they can't be read.
  modelFitOf(issue: IssueRef): Promise<string>;
  hasTranscript(sessionId: string): boolean;
}

interface SummaryRow {
  issue: IssueRef;
  spec: IssueRef;
  pair: string | undefined;
  filesChanged: number | undefined;
  peakContext: string | undefined;
  peaks: number[] | undefined;
  result: string | undefined;
  retries: number | undefined;
  durationMinutes: number | undefined;
  costUsd: number | undefined;
  // Undefined on a row whose Triage cost column counts triage alone, with the fixer under Cost.
  reviewCostUsd: number | undefined;
  hasTriageCost: boolean;
  sessionIds: string[] | undefined;
}

interface Section {
  spec: IssueRef;
  folder: string;
  rows: SummaryRow[];
  landedAt: Date;
}

interface RepoMedians {
  minutesPerFile: number[];
  costPerFile: number[];
}

const unrecorded = "unrecorded";
// The long-or-costly rule needs this many rows recording a figure in the row's repo.
const minimumMedianRows = 3;

// An older row's column and Result names, read under today's.
const currentNames = {
  columns: { Defers: "Proposals" } as Record<string, string>,
  results: {
    Fix: "Fix (resumed implementer)",
    "Triage fix": "Fix (fresh resolver)",
    "Handoff fix": "Fix (fresh resolver)",
  } as Record<string, string>,
};

const outlierResults = [
  "Fix (resumed implementer)",
  "Fix (fresh resolver)",
  "Halted then passed",
];

export async function outcomeSummaryOf(
  input: OutcomeSummaryInput,
): Promise<string> {
  const sections = selectedSectionsOf(
    sectionsOf(input.rowFiles),
    input.selection,
  );
  const rows = sections.flatMap((section) => section.rows);
  const medians = repoMediansOf(rows);
  const lines = [
    "# Outcome summary",
    "",
    `${countOf(sections.length, "spec section")}, ${countOf(rows.length, "row")}: ${sections.map(({ spec }) => labelOf(spec)).join(", ")}.`,
    `Ticket budget: ${kiloOf(input.ticketBudget)}. \`${unrecorded}\` is left out of every sum and median; each figure gives the rows it rests on.`,
    "",
    ...shareLinesOf(sections, rows),
    "",
    ...medianLinesOf(medians),
  ];
  for (const section of sections) {
    lines.push("", ...(await sectionLinesOf(section, medians, input)));
  }
  lines.push("", ...transcriptLinesOf(rows, input.hasTranscript));
  return `${lines.join("\n")}\n`;
}

function sectionsOf(rowFiles: OutcomeRowFile[]): Section[] {
  const byFolder = rowFiles.reduce((sections, file) => {
    const [folder, name, ...rest] = file.path.split("/");
    if (folder === undefined || name === undefined || rest.length > 0) {
      return sections;
    }
    const spec = refOf(folder);
    const issue = refOf(name.replace(/\.md$/, ""));
    if (spec === undefined || issue === undefined) return sections;
    const section = sections.get(folder) ?? {
      spec,
      folder,
      rows: [],
      landedAt: file.landedAt,
    };
    section.rows.push(rowOf(file.text, issue, spec));
    if (file.landedAt > section.landedAt) section.landedAt = file.landedAt;
    sections.set(folder, section);
    return sections;
  }, new Map<string, Section>());
  return [...byFolder.values()];
}

function selectedSectionsOf(
  sections: Section[],
  selection: SectionSelection,
): Section[] {
  const newestFirst = sections.toSorted(
    (first, second) => second.landedAt.getTime() - first.landedAt.getTime(),
  );
  if ("all" in selection) return newestFirst;
  if ("recent" in selection) return newestFirst.slice(0, selection.recent);
  const folder = selection.section.replace("#", "-");
  const section = sections.find((candidate) => candidate.folder === folder);
  if (section === undefined) {
    throw new Error(`No outcome section named ${selection.section}`);
  }
  return [section];
}

// A `<repo>-<n>` name; undefined for one that isn't, such as the legacy log.
function refOf(name: string): IssueRef | undefined {
  const match = /^(.+)-(\d+)$/.exec(name);
  if (match?.[1] === undefined || match[2] === undefined) return undefined;
  return { repo: match[1], number: Number(match[2]) };
}

function rowOf(text: string, issue: IssueRef, spec: IssueRef): SummaryRow {
  const cells = cellsByColumnOf(text);
  const recorded = new Map(
    [...cells].filter(([, cell]) => cell !== unrecorded),
  );
  const peakContext = recorded.get("Peak context");
  const result = recorded.get("Result");
  return {
    issue,
    spec,
    pair: recorded.get("Pair"),
    filesChanged: numberOf(recorded.get("Files changed")),
    peakContext,
    peaks: peakContext?.split("→").map((peak) => parseFloat(peak) * 1000),
    result: result === undefined ? undefined : currentResultOf(result),
    retries: numberOf(recorded.get("Retries")),
    durationMinutes: numberOf(recorded.get("Duration")),
    costUsd: numberOf(recorded.get("Cost (API-equivalent)")?.replace("$", "")),
    reviewCostUsd: numberOf(recorded.get("Review cost")?.replace("$", "")),
    hasTriageCost: cells.has("Triage cost"),
    sessionIds: recorded.get("Session ids")?.split(", "),
  };
}

// The table's header and its one row, the header read under today's column names.
function cellsByColumnOf(text: string): Map<string, string> {
  const lines = text.split("\n").filter((line) => line.startsWith("| "));
  const [header = "", , row = ""] = lines;
  const cells = cellsOfLine(row);
  return cellsOfLine(header).reduce((byColumn, column, index) => {
    byColumn.set(currentNames.columns[column] ?? column, cells[index] ?? "");
    return byColumn;
  }, new Map<string, string>());
}

function cellsOfLine(line: string): string[] {
  return line.slice(2, -2).split(/ (?<!\\)\| /);
}

function currentResultOf(result: string): string {
  return currentNames.results[result] ?? result;
}

function numberOf(cell: string | undefined): number | undefined {
  if (cell === undefined) return undefined;
  const value = parseFloat(cell);
  return Number.isNaN(value) ? undefined : value;
}

function shareLinesOf(sections: Section[], rows: SummaryRow[]): string[] {
  const repos = [...new Set(rows.map(({ issue }) => issue.repo))];
  return [
    "## Review's share of cost",
    "",
    "Review cost over Cost plus Review cost, on the rows recording both. Rows with a Triage cost column instead are left out: theirs is triage alone, with the fixer under Cost.",
    "",
    `- Batch: ${shareOf(rows)}`,
    ...repos.map(
      (repo) =>
        `- Repo ${repo}: ${shareOf(rows.filter(({ issue }) => issue.repo === repo))}`,
    ),
    ...sections.map(
      ({ spec, rows: specRows }) =>
        `- Spec ${labelOf(spec)}: ${shareOf(specRows)}`,
    ),
  ];
}

function shareOf(rows: SummaryRow[]): string {
  const costs = rows.flatMap(({ costUsd, reviewCostUsd }) => {
    if (costUsd === undefined || reviewCostUsd === undefined) return [];
    return [{ costUsd, reviewCostUsd }];
  });
  if (costs.length === 0) return "no row records both";
  const review = sumOf(costs.map(({ reviewCostUsd }) => reviewCostUsd));
  const total = review + sumOf(costs.map(({ costUsd }) => costUsd));
  const percent = total === 0 ? 0 : Math.round((review / total) * 100);
  return `${percent}% (${countOf(costs.length, "row")})`;
}

function repoMediansOf(rows: SummaryRow[]): Map<string, RepoMedians> {
  return rows.reduce((medians, row) => {
    const repo = medians.get(row.issue.repo) ?? {
      minutesPerFile: [],
      costPerFile: [],
    };
    const minutes = perFileOf(row.durationMinutes, row);
    const cost = perFileOf(row.costUsd, row);
    if (minutes !== undefined) repo.minutesPerFile.push(minutes);
    if (cost !== undefined) repo.costPerFile.push(cost);
    medians.set(row.issue.repo, repo);
    return medians;
  }, new Map<string, RepoMedians>());
}

// Undefined on a row with no files changed, which has no size to weigh by.
function perFileOf(
  figure: number | undefined,
  { filesChanged }: SummaryRow,
): number | undefined {
  if (figure === undefined || filesChanged === undefined) return undefined;
  if (filesChanged === 0) return undefined;
  return figure / filesChanged;
}

function medianLinesOf(medians: Map<string, RepoMedians>): string[] {
  return [
    "## Medians per repo",
    "",
    `Per file changed, pooled over the batch's rows in each repo; the long-or-costly rule needs ${minimumMedianRows} rows recording a figure.`,
    "",
    ...[...medians].map(
      ([repo, { minutesPerFile, costPerFile }]) =>
        `- Repo ${repo}: Duration ${medianTextOf(minutesPerFile, minutesOf)}; Cost ${medianTextOf(costPerFile, dollarsOf)}`,
    ),
  ];
}

function medianTextOf(
  values: number[],
  format: (value: number) => string,
): string {
  const median = medianOf(values);
  if (median === undefined) return "no row records it";
  return `${format(median)} per file (${countOf(values.length, "row")})`;
}

function medianOf(values: number[]): number | undefined {
  if (values.length === 0) return undefined;
  const sorted = values.toSorted((first, second) => first - second);
  const middle = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 1) return sorted[middle];
  return ((sorted[middle - 1] ?? 0) + (sorted[middle] ?? 0)) / 2;
}

async function sectionLinesOf(
  section: Section,
  medians: Map<string, RepoMedians>,
  { modelFitOf, ticketBudget, hasTranscript }: OutcomeSummaryInput,
): Promise<string[]> {
  const modelFits = await Promise.all(
    section.rows.map(({ issue }) => modelFitOf(issue)),
  );
  const outliers = section.rows.flatMap((row) => {
    const rules = outlierRulesOf(row, medians, ticketBudget);
    if (rules.length === 0) return [];
    return [
      `- ${labelOf(row.issue)}: ${rules.join("; ")}. ${sessionsTextOf(row, hasTranscript)}`,
    ];
  });
  return [
    `## Spec ${labelOf(section.spec)}`,
    "",
    `Rows: \`docs/agents/outcomes/${section.folder}/\`.`,
    "",
    "| Issue | Pair | Files changed | Peak context | Peak sum | Result | Retries | Duration | Cost | Review cost |",
    "| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |",
    ...section.rows.map(tableLineOf),
    "",
    "Outliers:",
    "",
    ...(outliers.length === 0 ? ["None."] : outliers),
    "",
    "Model fit:",
    "",
    ...section.rows.map(
      ({ issue }, index) => `- ${labelOf(issue)}: ${modelFits[index] ?? ""}`,
    ),
  ];
}

function tableLineOf(row: SummaryRow): string {
  const peakSum = peakSumOf(row);
  const cells = [
    labelOf(row.issue),
    row.pair ?? unrecorded,
    textOf(row.filesChanged),
    row.peakContext ?? unrecorded,
    peakSum === undefined ? unrecorded : kiloOf(peakSum),
    row.result ?? unrecorded,
    textOf(row.retries),
    row.durationMinutes === undefined
      ? unrecorded
      : minutesOf(row.durationMinutes),
    row.costUsd === undefined ? unrecorded : dollarsOf(row.costUsd),
    reviewCostTextOf(row),
  ];
  return `| ${cells.join(" | ")} |`;
}

function reviewCostTextOf({
  reviewCostUsd,
  hasTriageCost,
}: SummaryRow): string {
  if (hasTriageCost) return "Triage cost column";
  return reviewCostUsd === undefined ? unrecorded : dollarsOf(reviewCostUsd);
}

function outlierRulesOf(
  row: SummaryRow,
  medians: Map<string, RepoMedians>,
  ticketBudget: number,
): string[] {
  const rules: string[] = [];
  const { result, retries } = row;
  if (outlierResults.some((outlier) => result?.startsWith(outlier))) {
    rules.push(`Result ${result}`);
  }
  if (retries !== undefined && retries > 0) rules.push(`Retries ${retries}`);
  const peakSum = peakSumOf(row);
  if (peakSum !== undefined && peakSum > ticketBudget) {
    rules.push(
      `over budget (peak sum ${kiloOf(peakSum)} > ${kiloOf(ticketBudget)})`,
    );
  }
  const repo = medians.get(row.issue.repo);
  const long = sizeRuleOf({
    rule: "long",
    perFile: perFileOf(row.durationMinutes, row),
    values: repo?.minutesPerFile ?? [],
    format: minutesOf,
  });
  const costly = sizeRuleOf({
    rule: "costly",
    perFile: perFileOf(row.costUsd, row),
    values: repo?.costPerFile ?? [],
    format: dollarsOf,
  });
  return [...rules, ...long, ...costly];
}

function sizeRuleOf({
  rule,
  perFile,
  values,
  format,
}: {
  rule: string;
  perFile: number | undefined;
  values: number[];
  format: (value: number) => string;
}): string[] {
  const median = medianOf(values);
  if (perFile === undefined || median === undefined) return [];
  if (values.length < minimumMedianRows || perFile <= 2 * median) return [];
  return [
    `${rule} for its size (${format(perFile)} per file, over twice the repo median ${format(median)})`,
  ];
}

function peakSumOf({ peaks }: SummaryRow): number | undefined {
  return peaks === undefined ? undefined : sumOf(peaks);
}

function sessionsTextOf(
  { sessionIds }: SummaryRow,
  hasTranscript: (sessionId: string) => boolean,
): string {
  if (sessionIds === undefined) return "Sessions: never recorded.";
  const missing = sessionIds.filter((id) => !hasTranscript(id));
  const missingText =
    missing.length === 0 ? "" : ` (missing ${missing.join(", ")})`;
  return `Sessions: ${sessionIds.join(", ")}${missingText}.`;
}

function transcriptLinesOf(
  rows: SummaryRow[],
  hasTranscript: (sessionId: string) => boolean,
): string[] {
  const expired: string[] = [];
  const partlyExpired: string[] = [];
  const neverRecorded: string[] = [];
  rows.forEach((row) => {
    const label = labelOf(row.issue);
    if (row.sessionIds === undefined) {
      neverRecorded.push(label);
      return;
    }
    const missing = row.sessionIds.filter((id) => !hasTranscript(id));
    if (missing.length === row.sessionIds.length) expired.push(label);
    else if (missing.length > 0) {
      partlyExpired.push(`${label} (missing ${missing.join(", ")})`);
    }
  });
  return [
    "## Transcripts",
    "",
    `- Expired: ${listOf(expired)}`,
    `- Partly expired: ${listOf(partlyExpired)}`,
    `- Never recorded: ${listOf(neverRecorded)}`,
  ];
}

function listOf(items: string[]): string {
  return items.length === 0 ? "none" : items.join(", ");
}

function labelOf({ repo, number }: IssueRef): string {
  return `${repo}#${number}`;
}

function countOf(count: number, noun: string): string {
  return `${count} ${noun}${count === 1 ? "" : "s"}`;
}

function textOf(value: number | undefined): string {
  return value === undefined ? unrecorded : String(value);
}

function sumOf(values: number[]): number {
  return values.reduce((sum, value) => sum + value, 0);
}

function kiloOf(tokens: number): string {
  return `${Math.round(tokens / 1000)}K`;
}

function minutesOf(minutes: number): string {
  return `${Number(minutes.toFixed(1))} min`;
}

function dollarsOf(usd: number): string {
  return `$${usd.toFixed(2)}`;
}
