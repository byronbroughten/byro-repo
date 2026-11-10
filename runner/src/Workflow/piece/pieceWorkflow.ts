// The piece Workflow: a spec labelled piece runs under it. Its research step (#697) and drafting sequence (#639) aren't
// built yet, so it has no Steps and no agent steps, and its preflight refuses every launchable ticket, naming which is missing.
// A repo's runner config builds it with the commands and token path those steps will take, and ../../Workflow.ts registers it.

import { issueRef } from "../../IssueWorkspaces.ts";
import type { Command } from "../../runKnobs.ts";
import type { TrackedIssue } from "../../SpecRun/runState.ts";
import type { SpecEnd, Workflow } from "../../Workflow.ts";

const researchLabel = "research";

const specEnd: SpecEnd = {
  steps: [],
  isDue() {
    return false;
  },
};

// A repo's own values: the overlap check, the quote check and the Docs token file.
export interface PieceWorkflowInput {
  overlapCommand: Command;
  verifyQuotesCommand: Command;
  docsCredentialPath: string;
}

// The input is taken now so the runner config is settled; the research step and checks that read it come later.
export function pieceWorkflowOf(_input: PieceWorkflowInput): Workflow {
  return {
    name: "piece",
    stepsOf() {
      return [];
    },
    ticketRefusalOf,
    agentSteps: {},
    checks: [],
    specEnd,
  };
}

// The drafting refusal comes first, since #697 lifts only the research one.
function ticketRefusalOf(launchable: TrackedIssue[]): string | undefined {
  return draftingRefusalOf(launchable) ?? researchRefusalOf(launchable);
}

function draftingRefusalOf(launchable: TrackedIssue[]): string | undefined {
  const drafts = launchable.filter((ticket) => !isResearch(ticket));
  if (drafts.length === 0) return undefined;
  return `A piece spec's drafting sequence isn't built yet, so the runner runs only its research tickets; not research: ${labelsOf(drafts)}.`;
}

function researchRefusalOf(launchable: TrackedIssue[]): string | undefined {
  const research = launchable.filter(isResearch);
  if (research.length === 0) return undefined;
  return `A piece spec's research step isn't built yet, so the runner refuses its research tickets too: ${labelsOf(research)}.`;
}

function isResearch(ticket: TrackedIssue): boolean {
  return ticket.labels.includes(researchLabel);
}

function labelsOf(tickets: TrackedIssue[]): string {
  return tickets.map(({ issue }) => issueRef.labelOf(issue)).join(", ");
}
