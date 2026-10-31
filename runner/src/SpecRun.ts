// A spec run: takes one spec's tickets, one at a time in blocking-graph order, through implement, review, resolve, checks
// and wrap-up in each ticket's issue workspace, and never closes the spec; preflight refuses or Stops a run first.
// A blocker or a Halt verdict is a Halt: posted once the ticket's other work is committed, it holds the
// tickets in its scope, and the ticket resumes once every one of its Halts is answered (halts.ts).
// GitHub and git hold what's durable; a per-spec state file holds the step each ticket reached, so a rerun resumes there.
// This class only delegates: the run loop, ticket selection, a session's review, a review-list decision and every step they run are SpecRun/,
// one collaborator per concern. Steps launch through AgentStep.ts; landing is WrapUp.ts; knobs are runKnobs.ts.

import { type IssueRef } from "./IssueWorkspaces.ts";
import { type ItemDecision } from "./reviewList.ts";
import { ReviewItemDecider } from "./SpecRun/ReviewItemDecider.ts";
import { RunLoop } from "./SpecRun/RunLoop.ts";
import {
  type ResolveOptions,
  type ReviewOptions,
  type ReviewResult,
  type RunResult,
} from "./SpecRun/runState.ts";
import { SessionReviewer } from "./SpecRun/SessionReviewer.ts";
import { SpecRunBase, type SpecRunConfig } from "./SpecRun/SpecRunBase.ts";

export type { Clock, RunGitHub, SpecRunConfig } from "./SpecRun/SpecRunBase.ts";
export {
  type IssueComment,
  progressLogPathOf,
  rerunCommandOf,
  type ResolveOptions,
  type ReviewOptions,
  type ReviewResult,
  type RunResult,
  type TicketStep,
  type TrackedIssue,
} from "./SpecRun/runState.ts";
export { reviewPrintoutOf } from "./SpecRun/SessionReviewer.ts";

export class SpecRun extends SpecRunBase {
  static init(config: SpecRunConfig): SpecRun {
    return new SpecRun(config);
  }

  private get runLoop(): RunLoop {
    return new RunLoop(this.config);
  }

  private get sessionReviewer(): SessionReviewer {
    return new SessionReviewer(this.config);
  }

  private get reviewItemDecider(): ReviewItemDecider {
    return new ReviewItemDecider(this.config);
  }

  run(specIssue: IssueRef): Promise<RunResult> {
    return this.runLoop.run(specIssue);
  }

  requestStop(specIssue: IssueRef): void {
    this.runLoop.requestStop(specIssue);
  }

  status(specIssue: IssueRef): Promise<string> {
    return this.runLoop.status(specIssue);
  }

  review(issue: IssueRef, options: ReviewOptions): Promise<ReviewResult> {
    return this.sessionReviewer.review(issue, options);
  }

  resolve(issue: IssueRef, options: ResolveOptions): Promise<ReviewResult> {
    return this.sessionReviewer.resolve(issue, options);
  }

  decide(specIssue: IssueRef, decision: ItemDecision): Promise<string> {
    return this.reviewItemDecider.decide(specIssue, decision);
  }
}
