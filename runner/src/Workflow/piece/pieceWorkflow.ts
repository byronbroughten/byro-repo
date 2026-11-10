// The piece Workflow: a spec labelled piece runs under it. A research ticket runs its research step, from researchStep.ts,
// then its quote check, and lands with no code: its comment posted, its outcome row written and the ticket closed.
// Every other ticket is a drafting ticket, whose first Step pulls the Deliverable's Doc into the Agent draft, agentDraft.ts.
// The drafting Steps after pull aren't built, so a drafting ticket stops after it, unlanded.
// Every step reads the Drive files the spec's Supporting Material lists, as source targets, and no others.
// A repo's runner config builds it with its commands and Docs port, and ../../Workflow.ts registers it.

import { Docs } from "../../Docs.ts";
import type { DocumentsPort } from "../../Docs/googleDocs.ts";
import type { IssueRef } from "../../IssueWorkspaces.ts";
import type { Command } from "../../runKnobs.ts";
import type { TrackedIssue } from "../../SpecRun/runState.ts";
import { ticketSectionOf } from "../../ticketSections.ts";
import type { Target } from "../../ticketTargets.ts";
import type {
  PulledDraft,
  PullInput,
  PullRules,
  SpecEnd,
  Workflow,
  WorkflowStep,
} from "../../Workflow.ts";
import { agentDraft } from "./agentDraft.ts";
import {
  quoteSendBacks,
  researchClosingCommentOf,
  researchHandoffCommentOf,
  researchOutputSchema,
  researchPrompt,
  researchRecordOf,
  researchRecordProblems,
} from "./researchStep.ts";

const researchLabel = "research";
const specHeadings = {
  sources: "## Supporting Material",
  deliverable: "## Deliverable",
} as const;
// A Drive file ID, bare or inside a Drive URL; the spec names each source and its Deliverable by one.
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

// Implement is the drafting Step after pull, though no piece implement step exists yet.
const draftingSteps: WorkflowStep[] = [
  {
    step: "pull",
    nextOf() {
      return "implement";
    },
  },
];

const specEnd: SpecEnd = {
  steps: [],
  isDue() {
    return false;
  },
};

// A repo's own values: the overlap check, the quote check and the Docs port pull reads the Deliverable through.
export interface PieceWorkflowInput {
  overlapCommand: Command;
  // Called with `--comment <path> --texts <folder>` appended.
  verifyQuotesCommand: Command;
  documents: DocumentsPort;
}

// The overlap command is taken now so the runner config is settled; a later drafting Step reads it.
export function pieceWorkflowOf({
  verifyQuotesCommand,
  documents,
}: PieceWorkflowInput): Workflow {
  return {
    name: "piece",
    stepsOf(ticket) {
      return isResearch(ticket) ? researchSteps : draftingSteps;
    },
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
      },
    },
    // A drafting ticket lands its branch, the Agent draft's commits on it, as a code ticket does.
    landingOf(ticket) {
      return isResearch(ticket) ? "research" : "code";
    },
    checks: [],
    specEnd,
    pull: pullRulesOf(documents),
  };
}

// Each ID once, in the order the spec lists them; a spec with no Supporting Material lists none.
function sourceTargetsOf({ body }: TrackedIssue): Target[] {
  const ids = [...new Set(driveIdsOf(body, specHeadings.sources))];
  return ids.map((id) => ({ kind: "source", id }));
}

function driveIdsOf(body: string, heading: string): string[] {
  const section = ticketSectionOf(body, heading) ?? "";
  return section.match(driveIdPattern) ?? [];
}

function pullRulesOf(documents: DocumentsPort): PullRules {
  return {
    deliverableOf({ body }) {
      return driveIdsOf(body, specHeadings.deliverable)[0];
    },
    draftPathOf({ number }: IssueRef) {
      return `writing/agent-drafts/${number}.md`;
    },
    async pulledOf({ documentId, draft }: PullInput): Promise<PulledDraft> {
      const read = await Docs.init(documents).read(documentId);
      const held = draft === undefined ? [] : agentDraft.sectionsOf(draft);
      return {
        draft: agentDraft.draftOf(agentDraft.pulledOf(held, read.sections)),
        baseline: {
          documentId,
          revisionId: read.revisionId,
          sections: Object.fromEntries(read.sections),
        },
      };
    },
  };
}

function isResearch(ticket: TrackedIssue): boolean {
  return ticket.labels.includes(researchLabel);
}
