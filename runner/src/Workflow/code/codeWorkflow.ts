// The code Workflow's Step sequence: implement or resume, review, resolve, checks, then wrap-up; and each agent step's
// rules from its own module, resolve resuming implement.
// A repo's runner config builds it with its checks and review skill, and ../../Workflow.ts registers it; ../../SpecRun/TicketSequencer.ts walks it and runs each Step.

import type { Command } from "../../runKnobs.ts";
import type { TicketState, TicketStep } from "../../SpecRun/runState.ts";
import type {
  AgentSteps,
  SpecEnd,
  Workflow,
  WorkflowStep,
} from "../../Workflow.ts";
import {
  gapCheckOutputSchema,
  gapCheckPrompt,
  gapCheckRecordOf,
} from "./gapCheck.ts";
import {
  handoffCommentOf,
  implementOutputSchema,
  implementPrompt,
  implementRecordOf,
  implementRecordProblems,
} from "./implementStep.ts";
import {
  mergeMasterOutputSchema,
  mergeMasterPrompt,
} from "./mergeMasterStep.ts";
import { redChecksOutputSchema, redChecksPrompt } from "./redChecksStep.ts";
import {
  numberedFindingsOf,
  resolveCommitProblems,
  resolveOutputProblems,
  resolveOutputSchema,
  resolvePrompt,
  resolveRecordProblems,
  resolveRecordsOf,
  resolveRetryPrompt,
  withReviewerFields,
} from "./resolveStep.ts";
import { reviewPrompt, reviewRecordSchema } from "./reviewStep.ts";

const steps: WorkflowStep[] = [
  {
    step: "implement",
    nextOf(state) {
      // A ticket with no code has nothing to review or check.
      return state.record?.status === "applied" ? "wrap-up" : "review";
    },
  },
  { step: "resume", nextOf: stepAfterResumeOf },
  {
    step: "review",
    nextOf(state) {
      const hasFindings = (state.findings ?? []).length > 0;
      return hasFindings ? "resolve" : "checks";
    },
  },
  // Checks run after the resolve, so a fix that turns them red gets the red-checks resume.
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

const agentSteps: AgentSteps = {
  implement: {
    promptOf: implementPrompt,
    outputSchema: implementOutputSchema,
    recordOf: implementRecordOf,
    recordProblems: implementRecordProblems,
    handoffCommentOf,
  },
  review: { promptOf: reviewPrompt, outputSchema: reviewRecordSchema },
  resolve: {
    promptOf: resolvePrompt,
    retryPromptOf: resolveRetryPrompt,
    outputSchema: resolveOutputSchema,
    outputProblems: resolveOutputProblems,
    recordsOf: resolveRecordsOf,
    withReviewerFields,
    recordProblems: resolveRecordProblems,
    commitProblems: resolveCommitProblems,
    numberedFindingsOf,
    resumes: {
      step: "implement",
      freshRetryPromptOf(input, problems) {
        return `${resolvePrompt(input)}\n\n${resolveRetryPrompt(problems)}`;
      },
    },
  },
  redChecks: { promptOf: redChecksPrompt, outputSchema: redChecksOutputSchema },
  mergeMaster: {
    promptOf: mergeMasterPrompt,
    outputSchema: mergeMasterOutputSchema,
  },
  gapCheck: {
    promptOf: gapCheckPrompt,
    outputSchema: gapCheckOutputSchema,
    recordOf: gapCheckRecordOf,
  },
};

const specEnd: SpecEnd = {
  steps: ["gap-check"],
  // An open ticket may still land what the gap check would report.
  isDue(waits) {
    return waits.length === 0;
  },
};

// A repo's own values: the checks each ticket runs after review, and the skill its review step calls.
export interface CodeWorkflowInput {
  checks: Command[];
  reviewSkillName: string;
}

export function codeWorkflowOf({
  checks,
  reviewSkillName,
}: CodeWorkflowInput): Workflow {
  return {
    name: "code",
    // Every code ticket runs the same Steps, whatever its labels.
    stepsOf() {
      return steps;
    },
    agentSteps,
    checks,
    reviewSkillName,
    specEnd,
  };
}

// A ticket halted before review has nothing reviewed yet; one with no code has nothing to review.
function stepAfterResumeOf(state: TicketState): TicketStep {
  if (state.record?.status === "applied") return "wrap-up";
  return state.findings === undefined ? "review" : "checks";
}
