// The piece Workflow: a spec labelled piece runs under it. A research ticket runs its research step, from researchStep.ts,
// then its quote check, and lands with no code: its comment posted, its outcome row written and the ticket closed.
// What it couldn't verify and the Outline edits it proposes then go to the developer in one Research Halt, which holds the drafting tickets.
// Every step reads the Drive files the spec's Supporting Material lists, as source targets, and no others.
// The drafting sequence (#639) isn't built, so the preflight refuses every launchable ticket that isn't research.
// A repo's runner config builds it with its commands and token path, and ../../Workflow.ts registers it.

import { issueRef } from "../../IssueWorkspaces.ts";
import type { Command } from "../../runKnobs.ts";
import type { TrackedIssue } from "../../SpecRun/runState.ts";
import { ticketSectionOf } from "../../ticketSections.ts";
import type { Target } from "../../ticketTargets.ts";
import type { SpecEnd, Workflow, WorkflowStep } from "../../Workflow.ts";
import {
  quoteSendBacks,
  researchClosingCommentOf,
  researchHaltOf,
  researchHandoffCommentOf,
  researchOutputSchema,
  researchPrompt,
  researchRecordOf,
  researchRecordProblems,
} from "./researchStep.ts";

const researchLabel = "research";
const sourcesHeading = "## Supporting Material";
// A Drive file ID, bare or inside a Drive URL; the spec names each source by one.
const driveIdPattern = /[A-Za-z0-9_-]{25,}/g;

const researchSteps: WorkflowStep[] = [
  {
    step: "research",
    nextOf() {
      return "checks";
    },
  },
  {
    step: "checks",
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
  // Called with `--comment <path> --texts <folder>` appended.
  verifyQuotesCommand: Command;
  docsCredentialPath: string;
}

// The overlap command and Docs token are taken now so the runner config is settled; the drafting sequence reads them.
export function pieceWorkflowOf({
  verifyQuotesCommand,
}: PieceWorkflowInput): Workflow {
  return {
    name: "piece",
    // The preflight refuses every other ticket, so only a research ticket reaches its Steps.
    stepsOf() {
      return researchSteps;
    },
    ticketRefusalOf,
    sourceTargetsOf,
    agentSteps: {
      research: {
        promptOf: researchPrompt,
        outputSchema: researchOutputSchema,
        recordOf: researchRecordOf,
        recordProblems: researchRecordProblems,
        handoffCommentOf: researchHandoffCommentOf,
        quoteCheckOf({ commentPath, textsFolder }) {
          return [
            ...verifyQuotesCommand,
            "--comment",
            commentPath,
            "--texts",
            textsFolder,
          ];
        },
        sendBacks: quoteSendBacks,
        closingCommentOf: researchClosingCommentOf,
        haltOf: researchHaltOf,
        isDrafting(ticket) {
          return !isResearch(ticket);
        },
      },
    },
    landingOf() {
      return "research";
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

// Each ID once, in the order the spec lists them; a spec with no Supporting Material lists none.
function sourceTargetsOf({ body }: TrackedIssue): Target[] {
  const section = ticketSectionOf(body, sourcesHeading) ?? "";
  const ids = [...new Set(section.match(driveIdPattern) ?? [])];
  return ids.map((id) => ({ kind: "source", id }));
}

function isResearch(ticket: TrackedIssue): boolean {
  return ticket.labels.includes(researchLabel);
}

function labelsOf(tickets: TrackedIssue[]): string {
  return tickets.map(({ issue }) => issueRef.labelOf(issue)).join(", ");
}
