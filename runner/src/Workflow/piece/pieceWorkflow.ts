// The piece Workflow: a spec labelled piece runs under it. A research ticket runs its research step, from researchStep.ts,
// then its quote check, and lands with no code: its comment posted, its outcome row written and the ticket closed.
// What it couldn't verify and the Outline edits it proposes then go to the developer in one Research Halt, which holds the drafting tickets.
// Every other ticket is a drafting ticket: its first Step pulls the Deliverable's Doc into the Agent draft, agentDraft.ts,
// its implement step, implementStep.ts, drafts the ticket's Sections there, its review step, reviewStep.ts, reviews them,
// its resolve step, resolveStep.ts, resumes implement to settle the findings, its checks, pieceChecks.ts, run the overlap
// command and the length limit, sending red ones once to its red-checks step, redChecksStep.ts, and wrap-up lands its
// branch, so the next ticket's pull starts from its Agent draft.
// Every step reads the Drive files the spec's Supporting Material lists, as source targets, and no others.
// A repo's runner config builds it with its commands and Docs port, and ../../Workflow.ts registers it.

import { readFileSync } from "node:fs";
import { join } from "node:path";

import { Docs } from "../../Docs.ts";
import type { DocumentsPort } from "../../Docs/googleDocs.ts";
import type { IssueRef } from "../../IssueWorkspaces.ts";
import { resolveRulesOf } from "../../resolveRecords.ts";
import type { Command } from "../../runKnobs.ts";
import type { TrackedIssue } from "../../SpecRun/runState.ts";
import { handoffText } from "../../stepPrompts/handoffText.ts";
import {
  implementRecordOf,
  type PieceImplementRecord,
} from "../../stepRecords.ts";
import { ticketSectionOf } from "../../ticketSections.ts";
import type { Target } from "../../ticketTargets.ts";
import type {
  ImplementPromptInput,
  PulledDraft,
  PullInput,
  PullRules,
  RedChecksPromptInput,
  ReviewPromptInput,
  SpecEnd,
  Workflow,
  WorkflowStep,
} from "../../Workflow.ts";
import { agentDraft } from "./agentDraft.ts";
import {
  passagesFolderOf,
  pieceImplementOutputSchema,
  pieceImplementPrompt,
  pieceImplementRecordProblems,
} from "./implementStep.ts";
import { pieceChecks } from "./pieceChecks.ts";
import {
  pieceRedChecksOutputSchema,
  pieceRedChecksPrompt,
} from "./redChecksStep.ts";
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
import {
  pieceResolvePrompt,
  pieceResolveRecordProblems,
} from "./resolveStep.ts";
import { pieceReviewPrompt, pieceReviewRecordSchema } from "./reviewStep.ts";

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

const draftingSteps: WorkflowStep[] = [
  {
    step: "pull",
    nextOf() {
      return "implement";
    },
  },
  {
    step: "implement",
    nextOf() {
      return "review";
    },
  },
  {
    step: "resume",
    nextOf(state) {
      return state.findings === undefined ? "review" : "checks";
    },
  },
  {
    step: "review",
    nextOf(state) {
      const hasFindings = (state.findings ?? []).length > 0;
      return hasFindings ? "resolve" : "checks";
    },
  },
  {
    step: "resolve",
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

// A repo's own values: the overlap check, the quote check and the Docs port pull reads the Deliverable through.
export interface PieceWorkflowInput {
  overlapCommand: Command;
  // Called with `--comment <path> --texts <folder>` appended.
  verifyQuotesCommand: Command;
  documents: DocumentsPort;
}

export function pieceWorkflowOf({
  overlapCommand,
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
        haltOf: researchHaltOf,
        isDrafting(ticket) {
          return !isResearch(ticket);
        },
      },
      implement: {
        promptOf: draftingPromptOf,
        outputSchema: pieceImplementOutputSchema,
        recordOf: implementRecordOf<PieceImplementRecord>,
        recordProblems: pieceImplementRecordProblems,
        handoffCommentOf: handoffText.commentOf,
        keptFolderOf: passagesFolderOf,
      },
      review: {
        promptOf: reviewPromptOf,
        outputSchema: pieceReviewRecordSchema,
        skillName: "review-piece",
      },
      resolve: resolveRulesOf({
        promptOf(input) {
          return pieceResolvePrompt({
            ...input,
            draftPath: draftPathOf(input.spec),
            overlapCommand,
          });
        },
        recordProblems: pieceResolveRecordProblems,
      }),
      redChecks: {
        promptOf: redChecksPromptOf,
        outputSchema: pieceRedChecksOutputSchema,
      },
    },
    // A drafting ticket lands its branch, the Agent draft's commits on it, as a code ticket does.
    landingOf(ticket) {
      return isResearch(ticket) ? "research" : "code";
    },
    checks: [],
    async ticketChecksOf(input) {
      const draftPath = join(input.specClone, draftPathOf(input.spec.issue));
      return pieceChecks.failureOf({
        ...input,
        overlapCommand,
        draft: readFileSync(draftPath, "utf8"),
      });
    },
    specEnd,
    pull: pullRulesOf(documents),
  };
}

function draftingPromptOf(input: ImplementPromptInput): string {
  return pieceImplementPrompt({
    ...input,
    draftPath: draftPathOf(input.spec),
  });
}

function reviewPromptOf(input: ReviewPromptInput): string {
  return pieceReviewPrompt({ ...input, draftPath: draftPathOf(input.spec) });
}

function redChecksPromptOf(input: RedChecksPromptInput): string {
  return pieceRedChecksPrompt({ ...input, draftPath: draftPathOf(input.spec) });
}

function draftPathOf({ number }: IssueRef): string {
  return `writing/agent-drafts/${number}.md`;
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
    draftPathOf,
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
