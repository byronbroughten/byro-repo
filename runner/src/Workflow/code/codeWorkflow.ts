// The code Workflow's Step sequence: implement or resume, review, resolve, checks, then wrap-up; and each agent step's
// rules from its own module.
// A repo's runner config builds it with its checks and review skill, and ../../Workflow.ts registers it; ../../SpecRun/TicketSequencer.ts walks it and runs each Step.

import { readFileSync } from "node:fs";
import { join } from "node:path";

import { gapCheckOutputSchema, gapCheckRecordOf } from "../../recordSchema.ts";
import { resolveRecordProblems, resolveRulesOf } from "../../resolveRecords.ts";
import type { Command } from "../../runKnobs.ts";
import type { TicketState, TicketStep } from "../../SpecRun/runState.ts";
import { handoffText } from "../../stepPrompts/handoffText.ts";
import {
  caughtCellOf,
  implementRecordOf,
  implementRecordProblems,
  type ResolveRecord,
} from "../../stepRecords.ts";
import type {
  AgentSteps,
  ReviewPromptInput,
  SpecEnd,
  Workflow,
  WorkflowStep,
} from "../../Workflow.ts";
import { gapCheckPrompt } from "./gapCheck.ts";
import { implementOutputSchema, implementPrompt } from "./implementStep.ts";
import {
  mergeMasterOutputSchema,
  mergeMasterPrompt,
} from "./mergeMasterStep.ts";
import { redChecksOutputSchema, redChecksPrompt } from "./redChecksStep.ts";
import { resolvePrompt } from "./resolveStep.ts";
import {
  reviewerCheckOf,
  reviewPrompt,
  reviewRecordSchema,
} from "./reviewStep.ts";

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

const agentSteps: Omit<AgentSteps, "review" | "research"> = {
  implement: {
    promptOf: implementPrompt,
    outputSchema: implementOutputSchema,
    recordOf: implementRecordOf,
    recordProblems(output, hasNewCommit) {
      return implementRecordProblems(implementRecordOf(output), hasNewCommit);
    },
    handoffCommentOf: handoffText.commentOf,
  },
  resolve: resolveRulesOf({
    promptOf: resolvePrompt,
    recordProblems: resolveRecordProblems,
  }),
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
  // The gap check waits for every ticket to close, since an open one may still land what it would report.
  isDue(waits) {
    return waits.length === 0;
  },
  nextLineOf() {
    return undefined;
  },
};

// A repo's own values: the checks each ticket runs after review, and the skill whose SKILL.md its review prompt carries.
export interface CodeWorkflowInput {
  checks: Command[];
  reviewSkillName: string;
  // Reads a file by its absolute path; tests pass a fake, so no SKILL.md need be in a fixture's workspace.
  readText?: (path: string) => string;
}

export function codeWorkflowOf({
  checks,
  reviewSkillName,
  readText = readUtf8,
}: CodeWorkflowInput): Workflow {
  // The ticket's issue workspace's copy, the one the review would otherwise load itself.
  function reviewPromptOf(input: ReviewPromptInput): string {
    const skillPath = join(
      input.workspacePath,
      ".claude/skills",
      reviewSkillName,
      "SKILL.md",
    );
    return reviewPrompt({ ...input, skillText: readText(skillPath) });
  }

  return {
    name: "code",
    // Every code ticket runs the same Steps, whatever its labels.
    stepsOf() {
      return steps;
    },
    sessionSkillOf() {
      return "implement-code";
    },
    // A code ticket reads outside the repo only the targets its own body names.
    sourceTargetsOf() {
      return [];
    },
    agentSteps: {
      ...agentSteps,
      review: {
        promptOf: reviewPromptOf,
        outputSchema: reviewRecordSchema,
        skillName: reviewSkillName,
        reviewerCheck: reviewerCheckOf(reviewSkillName),
      },
    },
    landingOf() {
      return "code";
    },
    checks,
    specEnd,
    whatReviewCaughtOf: codeReviewCaughtOf,
  };
}

// The outcome row's text: each kept finding's claim and where.
export function codeReviewCaughtOf(
  records: ResolveRecord[],
): string | undefined {
  const caught = caughtCellOf(records, (kept) =>
    kept.map(({ claim, where }) => `${claim} (${where})`),
  );
  return caught === undefined ? undefined : `${caught}.`;
}

function readUtf8(path: string): string {
  return readFileSync(path, "utf8");
}

// A ticket halted before review has nothing reviewed yet; one with no code has nothing to review.
function stepAfterResumeOf(state: TicketState): TicketStep {
  if (state.record?.status === "applied") return "wrap-up";
  return state.findings === undefined ? "review" : "checks";
}
