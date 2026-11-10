// The code Workflow's Step sequence: implement or resume, review, resolve, checks, then wrap-up.
// ../../Workflow.ts registers it; ../../SpecRun/TicketSequencer.ts walks it and runs each Step.

import type { TicketState, TicketStep } from "../../SpecRun/runState.ts";
import type { Workflow, WorkflowStep } from "../../Workflow.ts";

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

export const codeWorkflow: Workflow = {
  name: "code",
  // Every code ticket runs the same Steps, whatever its labels.
  stepsOf() {
    return steps;
  },
};

// A ticket halted before review has nothing reviewed yet; one with no code has nothing to review.
function stepAfterResumeOf(state: TicketState): TicketStep {
  if (state.record?.status === "applied") return "wrap-up";
  return state.findings === undefined ? "review" : "checks";
}
