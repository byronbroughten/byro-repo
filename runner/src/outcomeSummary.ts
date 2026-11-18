// The outcome summary behind `npm run outcome:summary`: picks and filters the outcome log's rows and reports them by spec section.
// Row files come in as text, each dated by its own Landed cell, and Model fit and transcripts as lookups; scripts/runner/outcomeSummary.ts gathers them.
// outcomeSummary/summarySections.ts reads, filters and picks the rows; outcomeSummary/OutcomeReport.ts words them and holds the outlier rules.
// The row format is outcomeLog.ts's.

import type { IssueRef } from "./IssueWorkspaces.ts";
import { OutcomeReport } from "./outcomeSummary/OutcomeReport.ts";
import { summarySections } from "./outcomeSummary/summarySections.ts";
import type { WorkflowName } from "./Workflow.ts";

// The script's flag parse needs it, and Workflow.ts is no package entry.
export { isWorkflowName } from "./Workflow.ts";

// A starting value: enough rows for a tuning question, few enough that rows from before a model change don't outweigh it.
export const defaultRowCount = 200;

export interface OutcomeRowFile {
  // Relative to the outcome folder: `<spec repo>-<spec n>/<repo>-<n>.md`.
  path: string;
  text: string;
}

export type SectionScope =
  { section: string } | { recent: number } | { all: true } | { newest: number };

// Every filter given narrows the rows before the scope picks from them.
export interface SectionSelection {
  // With none, the newest `defaultRowCount` rows by landing date.
  scope?: SectionScope;
  workflow?: WorkflowName;
  pair?: string;
  // The ticket's repo, not its spec's.
  repo?: string;
  // A spec's folder or `<repo>#<n>` name.
  spec?: string;
  since?: Date;
  limitsToOutliers?: boolean;
}

export interface OutcomeSummaryInput {
  rowFiles: OutcomeRowFile[];
  selection: SectionSelection;
  // The folder the report names each section's rows under.
  outcomeFolder: string;
  ticketBudget: number;
  // The ticket's Model fit pair line and reason, or why they can't be read.
  modelFitOf(issue: IssueRef): Promise<string>;
  hasTranscript(sessionId: string): boolean;
}

export async function outcomeSummaryOf(
  input: OutcomeSummaryInput,
): Promise<string> {
  const { selection } = input;
  const sections = summarySections.selectedOf(input.rowFiles, {
    ...selection,
    scope: selection.scope ?? { newest: defaultRowCount },
  });
  return OutcomeReport.init(input, sections).text();
}
