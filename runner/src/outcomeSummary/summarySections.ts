import type { IssueRef } from "../IssueWorkspaces.ts";
import { unrecorded, writtenCellsOf } from "../outcomeLog.ts";
import type { OutcomeRowFile, SectionSelection } from "../outcomeSummary.ts";

export interface SummaryRow {
  issue: IssueRef;
  pair: string | undefined;
  filesChanged: number | undefined;
  peakContext: string | undefined;
  peaks: number[] | undefined;
  result: string | undefined;
  retries: number | undefined;
  durationMinutes: number | undefined;
  costUsd: number | undefined;
  reviewCostUsd: number | undefined;
  // A Triage cost column counts triage alone, with the fixer under Cost.
  hasTriageCost: boolean;
  sessionIds: string[] | undefined;
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

// The outcome log's spec sections, read from its row files; the legacy log, in no section, is left out.
export const summarySections = {
  selectedOf(
    rowFiles: OutcomeRowFile[],
    selection: SectionSelection,
  ): Section[] {
    const sections = sectionsOf(rowFiles);
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
  },
};

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
    section.rows.push(rowOf(file.text, issue));
    if (file.landedAt > section.landedAt) section.landedAt = file.landedAt;
    sections.set(folder, section);
    return sections;
  }, new Map<string, Section>());
  return [...byFolder.values()];
}

// A `<repo>-<n>` name; undefined for one that isn't, such as the legacy log.
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
  return {
    issue,
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

function currentResultOf(result: string): string {
  return currentResultByOlder[result] ?? result;
}

function numberOf(cell: string | undefined): number | undefined {
  if (cell === undefined) return undefined;
  const value = parseFloat(cell);
  return Number.isNaN(value) ? undefined : value;
}
