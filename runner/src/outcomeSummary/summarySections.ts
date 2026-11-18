import type { IssueRef } from "../IssueWorkspaces.ts";
import { labelOf, unrecorded, writtenCellsOf } from "../outcomeLog.ts";
import type { OutcomeRowFile, SectionSelection } from "../outcomeSummary.ts";
import { isWorkflowName, type WorkflowName } from "../Workflow.ts";

export interface SummaryRow {
  issue: IssueRef;
  workflow: WorkflowName;
  pair: string | undefined;
  filesChanged: number | undefined;
  // A blank cell, or a row older than the Estimate column, is a ticket never estimated.
  estimate: string | undefined;
  peakContext: string | undefined;
  peaks: number[] | undefined;
  result: string | undefined;
  retries: number | undefined;
  limitResumes: number | undefined;
  durationMinutes: number | undefined;
  costUsd: number | undefined;
  reviewCostUsd: number | undefined;
  // A Triage cost column counts triage alone, with the fixer under Cost.
  hasTriageCost: boolean;
  sessionIds: string[] | undefined;
  landedAt: Date;
}

export interface Section {
  spec: IssueRef;
  folder: string;
  rows: SummaryRow[];
  landedAt: Date;
}

// An older row's Result names, read under today's.
const currentResultByOlder: Record<string, string> = {
  Fix: "Fix (resumed implementer)",
  "Triage fix": "Fix (fresh resolver)",
  "Handoff fix": "Fix (fresh resolver)",
};

interface SectionRow {
  spec: IssueRef;
  folder: string;
  row: SummaryRow;
}

// A starting value: enough rows for a tuning question, few enough that rows from before a model change don't outweigh it.
export const defaultRowCount = 200;

// The outcome log's rows, read from its row files, filtered, picked and grouped into spec sections newest first.
export const summarySections = {
  selectedOf(
    rowFiles: OutcomeRowFile[],
    selection: SectionSelection,
  ): Section[] {
    const rows = rowFiles.map(sectionRowOf);
    const { scope } = selection;
    const filtered = rows.filter(filterOf(selection));
    if (scope === undefined) {
      const newestRows = filtered
        .toSorted(
          (first, second) =>
            second.row.landedAt.getTime() - first.row.landedAt.getTime(),
        )
        .slice(0, defaultRowCount);
      return newestFirst(sectionsOf(newestRows));
    }
    if ("all" in scope) return newestFirst(sectionsOf(filtered));
    if ("recent" in scope) {
      return newestFirst(sectionsOf(filtered)).slice(0, scope.recent);
    }
    const folder = folderOf(scope.section);
    if (!rows.some((row) => row.folder === folder)) {
      throw new Error(`No outcome section named ${scope.section}`);
    }
    return sectionsOf(filtered.filter((row) => row.folder === folder));
  },
};

function sectionRowOf(file: OutcomeRowFile): SectionRow {
  const [folder, name, ...rest] = file.path.split("/");
  const spec = folder === undefined ? undefined : refOf(folder);
  const issue =
    name === undefined ? undefined : refOf(name.replace(/\.md$/, ""));
  if (spec === undefined || issue === undefined || rest.length > 0) {
    throw new Error(
      `${file.path} is not a row file: <spec repo>-<spec n>/<repo>-<n>.md`,
    );
  }
  return { spec, folder: labelOf(spec, "-"), row: rowOf(file.text, issue) };
}

function filterOf({
  workflow,
  pair,
  repo,
  spec,
  since,
}: SectionSelection): (row: SectionRow) => boolean {
  if (workflow !== undefined && !isWorkflowName(workflow)) {
    throw new Error(`No Workflow named ${workflow}`);
  }
  const specFolder = spec === undefined ? undefined : folderOf(spec);
  return ({ folder, row }) =>
    (workflow === undefined || row.workflow === workflow) &&
    (pair === undefined || row.pair?.toLowerCase() === pair.toLowerCase()) &&
    (repo === undefined || row.issue.repo === repo) &&
    (specFolder === undefined || folder === specFolder) &&
    (since === undefined || row.landedAt >= since);
}

// A spec named by its folder, `<repo>-<n>`, or as `<repo>#<n>`.
function folderOf(spec: string): string {
  return spec.replace("#", "-");
}

function sectionsOf(rows: SectionRow[]): Section[] {
  const byFolder = rows.reduce((sections, { spec, folder, row }) => {
    const section = sections.get(folder) ?? {
      spec,
      folder,
      rows: [],
      landedAt: row.landedAt,
    };
    section.rows.push(row);
    if (row.landedAt > section.landedAt) section.landedAt = row.landedAt;
    sections.set(folder, section);
    return sections;
  }, new Map<string, Section>());
  return [...byFolder.values()];
}

function newestFirst(sections: Section[]): Section[] {
  return sections.toSorted(
    (first, second) => second.landedAt.getTime() - first.landedAt.getTime(),
  );
}

// The outcome folder is gitignored, so a row's own Landed cell is the only date it has.
function landedAtOf(text: string, issue: IssueRef): Date {
  const landed = writtenCellsOf(text).get("Landed");
  if (landed === undefined) {
    throw new Error(`${labelOf(issue, "#")}'s row has no Landed cell`);
  }
  return new Date(landed);
}

// A `<repo>-<n>` name; undefined for one that isn't.
function refOf(name: string): IssueRef | undefined {
  const match = /^(.+)-(\d+)$/.exec(name);
  if (match?.[1] === undefined || match[2] === undefined) return undefined;
  return { repo: match[1], number: Number(match[2]) };
}

function rowOf(text: string, issue: IssueRef): SummaryRow {
  const cells = writtenCellsOf(text);
  const recorded = new Map(
    [...cells].filter(([, cell]) => cell !== unrecorded),
  );
  const peakContext = recorded.get("Peak context");
  const result = recorded.get("Result");
  const workflow = cells.get("Workflow");
  if (!isWorkflowName(workflow)) {
    throw new Error(`${labelOf(issue, "#")}'s Workflow cell is not a Workflow`);
  }
  return {
    issue,
    workflow,
    pair: recorded.get("Pair"),
    filesChanged: numberOf(recorded.get("Files changed")),
    estimate: recorded.get("Estimate") || undefined,
    peakContext,
    peaks: peakContext?.split("→").map((peak) => parseFloat(peak) * 1000),
    result: result === undefined ? undefined : currentResultOf(result),
    retries: numberOf(recorded.get("Retries")),
    limitResumes: numberOf(recorded.get("Limit resumes")),
    durationMinutes: numberOf(recorded.get("Duration")),
    costUsd: numberOf(recorded.get("Cost (API-equivalent)")?.replace("$", "")),
    reviewCostUsd: numberOf(recorded.get("Review cost")?.replace("$", "")),
    hasTriageCost: cells.has("Triage cost"),
    sessionIds: recorded.get("Session ids")?.split(", "),
    landedAt: landedAtOf(text, issue),
  };
}

function currentResultOf(result: string): string {
  return currentResultByOlder[result] ?? result;
}

function numberOf(cell: string | undefined): number | undefined {
  if (cell === undefined) return undefined;
  const value = parseFloat(cell);
  return Number.isNaN(value) ? undefined : value;
}
