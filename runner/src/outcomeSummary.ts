// The outcome summary behind `npm run outcome:summary`: picks spec sections of the outcome log and reports what `/mine-outcomes` reads in place of the rows.
// Row files come in as text with each one's landing date, and Model fit and transcripts as lookups; scripts/runner/outcomeSummary.ts gathers them.
// outcomeSummary/summarySections.ts reads the sections and outcomeSummary/OutcomeReport.ts words them; the row format is outcomeLog.ts's.
// The outlier rules are runner/skills/mine-outcomes/SKILL.md's.

import type { IssueRef } from "./IssueWorkspaces.ts";
import { OutcomeReport } from "./outcomeSummary/OutcomeReport.ts";
import { summarySections } from "./outcomeSummary/summarySections.ts";

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
  // Relative to the repo root, as the report names each section's folder.
  outcomeFolder: string;
  ticketBudget: number;
  // The ticket's Model fit pair line and reason, or why they can't be read.
  modelFitOf(issue: IssueRef): Promise<string>;
  hasTranscript(sessionId: string): boolean;
}

export async function outcomeSummaryOf(
  input: OutcomeSummaryInput,
): Promise<string> {
  const sections = summarySections.selectedOf(input.rowFiles, input.selection);
  return OutcomeReport.init(input, sections).text();
}
