// The piece Workflow: a spec labelled piece runs under it. A research ticket runs its research step, from researchStep.ts;
// its checks and landing (#659) aren't built yet, so the ticket stops after the step, naming the comment the step wrote.
// The drafting sequence (#639) isn't built either, so the preflight refuses every launchable ticket that isn't research.
// A repo's runner config builds it with the commands and token path #659's checks will take, and ../../Workflow.ts registers it.

import { issueRef } from "../../IssueWorkspaces.ts";
import type { Command } from "../../runKnobs.ts";
import type { TicketState, TrackedIssue } from "../../SpecRun/runState.ts";
import type { SpecEnd, Workflow, WorkflowStep } from "../../Workflow.ts";
import {
  researchHandoffCommentOf,
  researchOutputSchema,
  researchPrompt,
  researchRecordOf,
  researchRecordProblems,
} from "./researchStep.ts";

const researchLabel = "research";

// The research step needs a next step, so the core's landing comes after it; landingStopOf stops it there until #659.
const researchSteps: WorkflowStep[] = [
  {
    step: "research",
    nextOf() {
      return "wrap-up";
    },
  },
  { step: "wrap-up" },
];

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

// The input is taken now so the runner config is settled; the checks that read it come with #659.
export function pieceWorkflowOf(_input: PieceWorkflowInput): Workflow {
  return {
    name: "piece",
    // The preflight refuses every other ticket, so only a research ticket reaches its Steps.
    stepsOf() {
      return researchSteps;
    },
    ticketRefusalOf,
    landingStopOf,
    agentSteps: {
      research: {
        promptOf: researchPrompt,
        outputSchema: researchOutputSchema,
        recordOf: researchRecordOf,
        recordProblems: researchRecordProblems,
        handoffCommentOf: researchHandoffCommentOf,
      },
    },
    checks: [],
    specEnd,
  };
}

function ticketRefusalOf(launchable: TrackedIssue[]): string | undefined {
  const drafts = launchable.filter((ticket) => !isResearch(ticket));
  if (drafts.length === 0) return undefined;
  return `A piece spec's drafting sequence isn't built yet, so the runner runs only its research tickets; not research: ${labelsOf(drafts)}.`;
}

function landingStopOf({ researchRecord }: TicketState): string {
  const comment =
    researchRecord?.status === "ready"
      ? `The research step wrote its comment, unposted, at \`${researchRecord.commentPath}\`.`
      : "The research step left no comment.";
  return `${comment} The runner can't check or land a research ticket until #659, so the run stops after its research step.`;
}

function isResearch(ticket: TrackedIssue): boolean {
  return ticket.labels.includes(researchLabel);
}

function labelsOf(tickets: TrackedIssue[]): string {
  return tickets.map(({ issue }) => issueRef.labelOf(issue)).join(", ");
}
