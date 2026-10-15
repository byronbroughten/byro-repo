// An outcome no run-loop ticket handles yet: SpecRun.ts leaves the ticket unlanded, comments, sends a notice and ends the run.
export const stopOutcomes = {
  "review-findings": "review findings",
  "red-checks": "red checks",
  "step-error": "a step error",
  blocker: "a blocker in the implement record",
  "schema-failure": "a schema failure",
  handoff: "an implement handoff",
  "wrap-up-failure": "a wrap-up failure",
  workspace: "a workspace that can't resume",
  "model-fit": "a missing or invalid Model fit",
  targets: "a malformed Targets section",
  "limit-hit": "a limit hit",
} as const;

export type StopOutcome = keyof typeof stopOutcomes;

export class UnhandledStop extends Error {
  readonly outcome: StopOutcome;
  readonly logPath: string;

  constructor(outcome: StopOutcome, detail: string, logPath: string) {
    super(detail);
    this.name = "UnhandledStop";
    this.outcome = outcome;
    this.logPath = logPath;
  }
}
