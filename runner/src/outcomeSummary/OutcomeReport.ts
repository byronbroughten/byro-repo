import type { IssueRef } from "../IssueWorkspaces.ts";
import { dollarsOf, kiloOf, labelOf, unrecorded } from "../outcomeLog.ts";
import type { OutcomeSummaryInput } from "../outcomeSummary.ts";
import type { Section, SummaryRow } from "./summarySections.ts";

interface RepoMedians {
  minutesPerFile: number[];
  costPerFile: number[];
}

interface SizeRule {
  rule: string;
  perFile: number | undefined;
  values: number[];
  format: (value: number) => string;
}

// The long-or-costly rule needs this many rows recording a figure in the row's repo.
const minimumMedianRows = 3;

const outlierResults = [
  "Fix (resumed implementer)",
  "Fix (fresh resolver)",
  "Halted then passed",
];

// The summary's text for a batch of sections: shares, medians, each spec's rows, outliers and Model fit, then transcripts.
export class OutcomeReport {
  private readonly input: OutcomeSummaryInput;
  private readonly sections: Section[];
  private readonly rows: SummaryRow[];
  private readonly medians: Map<string, RepoMedians>;

  constructor(input: OutcomeSummaryInput, sections: Section[]) {
    this.input = input;
    this.sections = sections;
    this.rows = sections.flatMap((section) => section.rows);
    this.medians = repoMediansOf(this.rows);
  }

  static init(input: OutcomeSummaryInput, sections: Section[]): OutcomeReport {
    return new OutcomeReport(input, sections);
  }

  async text(): Promise<string> {
    const { sections, rows } = this;
    const lines = [
      "# Outcome summary",
      "",
      `${countOf(sections.length, "spec section")}, ${countOf(rows.length, "row")}: ${sections.map(({ spec }) => issueLabelOf(spec)).join(", ")}.`,
      `Ticket budget: ${kiloOf(this.input.ticketBudget)}. \`${unrecorded}\` is left out of every sum and median; each figure gives the rows it rests on.`,
      "",
      ...this._shareLines(),
      "",
      ...this._medianLines(),
    ];
    for (const section of sections) {
      lines.push("", ...(await this._sectionLinesOf(section)));
    }
    lines.push("", ...this._transcriptLines());
    return `${lines.join("\n")}\n`;
  }

  private _shareLines(): string[] {
    const { sections, rows } = this;
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
          `- Spec ${issueLabelOf(spec)}: ${shareOf(specRows)}`,
      ),
    ];
  }

  private _medianLines(): string[] {
    return [
      "## Medians per repo",
      "",
      `Per file changed, pooled over the batch's rows in each repo; the long-or-costly rule needs ${minimumMedianRows} rows recording a figure.`,
      "",
      ...[...this.medians].map(
        ([repo, { minutesPerFile, costPerFile }]) =>
          `- Repo ${repo}: Duration ${medianTextOf(minutesPerFile, minutesOf)}; Cost ${medianTextOf(costPerFile, dollarsOf)}`,
      ),
    ];
  }

  private async _sectionLinesOf(section: Section): Promise<string[]> {
    const modelFits = await Promise.all(
      section.rows.map(({ issue }) => this.input.modelFitOf(issue)),
    );
    const outliers = section.rows.flatMap((row) => {
      const rules = this._outlierRulesOf(row);
      if (rules.length === 0) return [];
      return [
        `- ${issueLabelOf(row.issue)}: ${rules.join("; ")}. ${this._sessionsTextOf(row)}`,
      ];
    });
    return [
      `## Spec ${issueLabelOf(section.spec)}`,
      "",
      `Rows: \`${this.input.outcomeFolder}/${section.folder}/\`.`,
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
        ({ issue }, index) =>
          `- ${issueLabelOf(issue)}: ${modelFits[index] ?? ""}`,
      ),
    ];
  }

  private _outlierRulesOf(row: SummaryRow): string[] {
    const { ticketBudget } = this.input;
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
    const repo = this.medians.get(row.issue.repo);
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

  private _sessionsTextOf(row: SummaryRow): string {
    const { sessionIds } = row;
    if (sessionIds === undefined) return "Sessions: never recorded.";
    return `Sessions: ${sessionIds.join(", ")}${missingTextOf(this._missingSessionsOf(row))}.`;
  }

  private _transcriptLines(): string[] {
    const expired: string[] = [];
    const partlyExpired: string[] = [];
    const neverRecorded: string[] = [];
    this.rows.forEach((row) => {
      const label = issueLabelOf(row.issue);
      if (row.sessionIds === undefined) {
        neverRecorded.push(label);
        return;
      }
      const missing = this._missingSessionsOf(row);
      if (missing.length === row.sessionIds.length) expired.push(label);
      else if (missing.length > 0) {
        partlyExpired.push(`${label}${missingTextOf(missing)}`);
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

  private _missingSessionsOf({ sessionIds }: SummaryRow): string[] {
    return (sessionIds ?? []).filter((id) => !this.input.hasTranscript(id));
  }
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

function issueLabelOf(issue: IssueRef): string {
  return labelOf(issue, "#");
}

function countOf(count: number, noun: string): string {
  return `${count} ${noun}${count === 1 ? "" : "s"}`;
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

function sumOf(values: number[]): number {
  return values.reduce((sum, value) => sum + value, 0);
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

function minutesOf(minutes: number): string {
  return `${Number(minutes.toFixed(1))} min`;
}

function tableLineOf(row: SummaryRow): string {
  const peakSum = peakSumOf(row);
  const cells = [
    issueLabelOf(row.issue),
    row.pair ?? unrecorded,
    textOf(row.filesChanged),
    row.peakContext ?? unrecorded,
    peakSum === undefined ? unrecorded : kiloOf(peakSum),
    row.result ?? unrecorded,
    textOf(row.retries),
    row.durationMinutes === undefined
      ? unrecorded
      : minutesOf(row.durationMinutes),
    dollarsOf(row.costUsd),
    row.hasTriageCost ? "Triage cost column" : dollarsOf(row.reviewCostUsd),
  ];
  return `| ${cells.join(" | ")} |`;
}

function textOf(value: number | undefined): string {
  return value === undefined ? unrecorded : String(value);
}

function peakSumOf({ peaks }: SummaryRow): number | undefined {
  return peaks === undefined ? undefined : sumOf(peaks);
}

function sizeRuleOf({ rule, perFile, values, format }: SizeRule): string[] {
  const median = medianOf(values);
  if (perFile === undefined || median === undefined) return [];
  if (values.length < minimumMedianRows || perFile <= 2 * median) return [];
  return [
    `${rule} for its size (${format(perFile)} per file, over twice the repo median ${format(median)})`,
  ];
}

function missingTextOf(missing: string[]): string {
  return missing.length === 0 ? "" : ` (missing ${missing.join(", ")})`;
}

function listOf(items: string[]): string {
  return items.length === 0 ? "none" : items.join(", ");
}
