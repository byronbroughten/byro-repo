// The piece Workflow: a spec labelled piece runs under it. A research ticket runs its research step, from researchStep/,
// carrying /research-piece's and /review-research's bodies inline, then its quote check, and lands with no code: its comment posted, its outcome row written and the ticket closed.
// What it couldn't verify and the Outline edits it proposes then go to the developer in one Research Halt, which holds the drafting tickets.
// Every other ticket is a drafting ticket: its first Step pulls the Deliverable's Doc into the Agent draft, agentDraft.ts,
// its implement step, implementStep.ts, drafts the ticket's Sections there, its review step, reviewStep.ts, reviews them,
// its resolve step, resolveStep.ts, resumes implement to settle the findings, its checks, pieceChecks.ts, run the overlap
// command and the length limit, sending red ones to its red-checks step, redChecksStep.ts, and wrap-up lands its
// branch, so the next ticket's pull starts from its Agent draft.
// Once every ticket but the Edit gate has landed or closed, the spec-end Steps run: the gap check, gapCheck.ts, then the judge Step,
// which ends a run holding an undecided review-list item with "judge, then rerun", then the push, which writes the Agent draft's
// agent Sections into the Deliverable once; the run then ends at the Edit gate, and no agent writes the Piece after it.
// Every step reads the Drive files the spec's Supporting Material lists, as source targets, and no others.
// A repo's runner config builds it with its commands and Docs port, and ../../Workflow.ts registers it.

import { readFileSync } from "node:fs";
import { join } from "node:path";

import { closeOutWords } from "../../CloseOutBrief/closeOutWords.ts";
import { Docs } from "../../Docs.ts";
import type { DocumentsPort } from "../../Docs/googleDocs.ts";
import type { IssueRef } from "../../IssueWorkspaces.ts";
import { resolveRulesOf } from "../../resolveRecords.ts";
import type { Command } from "../../runKnobs.ts";
import {
  humanLabel,
  type TrackedIssue,
  type Wait,
} from "../../SpecRun/runState.ts";
import { handoffText } from "../../stepPrompts/handoffText.ts";
import { inlinedSkill, type ReadText } from "../../stepPrompts/inlinedSkill.ts";
import {
  implementRecordOf,
  type PieceImplementRecord,
} from "../../stepRecords.ts";
import { ticketSectionOf } from "../../ticketSections.ts";
import type { Target } from "../../ticketTargets.ts";
import {
  type ImplementPromptInput,
  type PulledDraft,
  type PullInput,
  type PullRules,
  type RedChecksPromptInput,
  type ResearchPromptInput,
  type ReviewPromptInput,
  type SpecEnd,
  type Workflow,
  type WorkflowStep,
} from "../../Workflow.ts";
import { agentDraft } from "./agentDraft.ts";
import { draftingScope } from "./draftingScope.ts";
import { pieceGapCheckSectionOf } from "./gapCheck.ts";
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
  researchOutputSchema,
  researchRecordOf,
  researchRecordProblems,
} from "./researchStep/researchRecord.ts";
import {
  quoteSendBacks,
  researchClosingCommentOf,
  researchHaltOf,
  researchHandoffCommentOf,
  researchPrompt,
  researchScratchFolderOf,
  researchSkillNames,
} from "./researchStep/researchWords.ts";
import {
  pieceResolvePrompt,
  pieceResolveRecordProblems,
} from "./resolveStep.ts";
import { reviewInputs } from "./reviewInputs.ts";
import {
  pieceReviewerCheckOf,
  pieceReviewPrompt,
  pieceReviewRecordSchema,
} from "./reviewStep.ts";

// The labels the Workflow reads on a ticket: a Research ticket's, and the Edit gate's.
const ticketLabels = {
  research: "research",
  editGate: humanLabel,
} as const;
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
  steps: ["gap-check", "judge", "push"],
  // The Edit gate stays open until the developer's edit, after the push, so it alone doesn't hold these Steps.
  isDue(waits) {
    return waits.every(isEditGateWait);
  },
  nextLineOf(spec, waits) {
    const gate = waits.find(isEditGateWait);
    const documentId = deliverableIdOf(spec);
    if (gate === undefined || documentId === undefined) return undefined;
    return `Edit the Deliverable in its Doc, ${docLinkOf(documentId)}, then close out the Edit gate: ${closeOutWords.closeProjectOf(spec.issue)}.`;
  },
};

// A repo's own values: its overlap and quote checks and the Docs port pull and push reach the Deliverable through.
export interface PieceWorkflowInput {
  overlapCommand: Command;
  // Called with `--comment <path> --texts <folder>` appended.
  verifyQuotesCommand: Command;
  documents: DocumentsPort;
  readText?: ReadText;
}

export function pieceWorkflowOf({
  overlapCommand,
  verifyQuotesCommand,
  documents,
  readText,
}: PieceWorkflowInput): Workflow {
  function reviewPromptOf(input: ReviewPromptInput): string {
    return pieceReviewPrompt({
      ...input,
      draftPath: draftPathOf(input.spec),
      skillText: inlinedSkill.textIn({ ...input, readText }),
    });
  }

  function researchPromptOf(input: ResearchPromptInput): string {
    function skillTextOf(skillName: string): string {
      return inlinedSkill.textIn({
        workspacePath: input.workspacePath,
        skillName,
        readText,
      });
    }
    return researchPrompt({
      ...input,
      researchSkillText: skillTextOf(researchSkillNames.research),
      reviewSkillText: skillTextOf(researchSkillNames.review),
    });
  }

  return {
    name: "piece",
    stepsOf(ticket) {
      return isResearch(ticket) ? researchSteps : draftingSteps;
    },
    sessionSkillOf(ticket) {
      if (isResearch(ticket)) return "research-piece";
      if (ticket.labels.includes(ticketLabels.editGate)) return "close-project";
      return "implement-piece";
    },
    sourceTargetsOf,
    agentSteps: {
      research: {
        promptOf: researchPromptOf,
        scratchFolderOf: researchScratchFolderOf,
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
        recordProblems(output, hasNewCommit, { spec, ticket, specClone }) {
          return pieceImplementRecordProblems(output, hasNewCommit, {
            isFinalPass: draftingScope.isFinalPass(ticket.labels),
            draftOf() {
              return draftIn(specClone, spec);
            },
          });
        },
        handoffCommentOf: handoffText.commentOf,
        keptFolderOf: passagesFolderOf,
      },
      review: {
        promptOf: reviewPromptOf,
        outputSchema: pieceReviewRecordSchema,
        skillName: "review-piece",
        reviewerCheck: pieceReviewerCheckOf("review-piece"),
        suppliedInputsOf(context) {
          return reviewInputs.write({
            ...context,
            overlapCommand,
            draftPath: draftPathOf(context.spec.issue),
            isResearch,
          });
        },
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
      gapCheck: {
        sectionOf(spec) {
          return pieceGapCheckSectionOf(draftPathOf(spec));
        },
      },
    },
    // A drafting ticket lands its branch, the Agent draft's commits on it, as a code ticket does.
    landingOf(ticket) {
      return isResearch(ticket) ? "research" : "code";
    },
    checks: [],
    async ticketChecksOf(input) {
      return pieceChecks.failureOf({
        ...input,
        overlapCommand,
        draft: draftIn(input.specClone, input.spec),
      });
    },
    specEnd,
    pull: pullRulesOf(documents),
    push: {
      agentSectionsOf: agentDraft.agentSectionsOf,
      keptOf: agentDraft.keptOf,
      get docs() {
        return Docs.init(documents);
      },
    },
  };
}

function draftingPromptOf(input: ImplementPromptInput): string {
  return pieceImplementPrompt({
    ...input,
    draftPath: draftPathOf(input.spec),
  });
}

function redChecksPromptOf(input: RedChecksPromptInput): string {
  return pieceRedChecksPrompt({ ...input, draftPath: draftPathOf(input.spec) });
}

function draftPathOf({ number }: IssueRef): string {
  return agentDraft.pathOf(number);
}

// The Agent draft as the spec's clone in the workspace holds it.
function draftIn(specClone: string, spec: TrackedIssue): string {
  return readFileSync(join(specClone, draftPathOf(spec.issue)), "utf8");
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

function deliverableIdOf({
  body,
}: Pick<TrackedIssue, "body">): string | undefined {
  return driveIdsOf(body, specHeadings.deliverable)[0];
}

function docLinkOf(documentId: string): string {
  return `https://docs.google.com/document/d/${documentId}/edit`;
}

function pullRulesOf(documents: DocumentsPort): PullRules {
  return {
    deliverableOf: deliverableIdOf,
    draftPathOf,
    async pulledOf({ documentId, draft }: PullInput): Promise<PulledDraft> {
      const read = await Docs.init(documents).read(documentId);
      const held = draft === undefined ? [] : agentDraft.sectionsOf(draft);
      return {
        draft: agentDraft.draftOf(
          agentDraft.pulledOf(held, read.markdown, read.headingIds),
        ),
        baseline: {
          documentId,
          revisionId: read.revisionId,
          sections: Object.fromEntries(read.sections),
        },
      };
    },
  };
}

function isResearch(ticket: Pick<TrackedIssue, "labels">): boolean {
  return ticket.labels.includes(ticketLabels.research);
}

function isEditGateWait({ reason, labels = [] }: Wait): boolean {
  return reason === "developer" && labels.includes(ticketLabels.editGate);
}
