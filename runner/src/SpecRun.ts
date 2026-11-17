// A spec run: takes one spec's tickets, one at a time in blocking-graph order, through implement, review, resolve, checks
// and wrap-up in each ticket's issue workspace, and never closes the spec; preflight refuses or Stops a run first.
// A blocker or a Halt verdict is a Halt: posted once the ticket's other work is committed, it holds the
// tickets in its scope, and the ticket resumes once every one of its Halts is answered (halts.ts).
// GitHub and git hold what's durable; a per-spec state file holds the step each ticket reached, so a rerun resumes there.
// This class only delegates: the run loop, its preflight, status and stop requests, `open`'s launch or rejoin and the Supervisor's catch-up, ticket selection, a session's review, a review-list decision, the list of issues to judge, each spec's judging brief, the list of launchable Standalone tickets and every step they run are SpecRun/,
// one collaborator per concern. Steps launch through AgentStep.ts; landing is WrapUp.ts; knobs are runKnobs.ts.

import { type IssueRef, type LeaseHolder } from "./IssueWorkspaces.ts";
import { type ItemDecision } from "./reviewList.ts";
import { JudgeableIssueLister } from "./SpecRun/JudgeableIssueLister.ts";
import {
  JudgeBriefWriter,
  type JudgedSpecs,
} from "./SpecRun/JudgeBriefWriter.ts";
import { ReviewItemDecider } from "./SpecRun/ReviewItemDecider.ts";
import { RunLoop } from "./SpecRun/RunLoop.ts";
import {
  type CatchUp,
  type OpenOptions,
  type OpenResult,
  RunOpener,
} from "./SpecRun/RunOpener.ts";
import {
  type MemberList,
  type ResolveOptions,
  type ReviewOptions,
  type ReviewResult,
  type RunResult,
  type SubmitOptions,
} from "./SpecRun/runState.ts";
import { SessionReviewer } from "./SpecRun/SessionReviewer.ts";
import { SpecRunBase, type SpecRunConfig } from "./SpecRun/SpecRunBase.ts";
import { StandaloneTicketLister } from "./SpecRun/StandaloneTicketLister.ts";
import { StatusReporter } from "./SpecRun/StatusReporter.ts";

export type { Clock, RunGitHub, SpecRunConfig } from "./SpecRun/SpecRunBase.ts";
export {
  type IssueComment,
  type MemberList,
  type ResolveOptions,
  type ReviewOptions,
  type ReviewResult,
  type RunResult,
  type SubmitOptions,
  type SubmittedSession,
  type TicketStep,
  type TrackedIssue,
} from "./SpecRun/runState.ts";
export {
  type CatchUp,
  handoffBlockOf,
  type LaunchReport,
  type OpenOptions,
  type OpenResult,
  type RunLauncher,
} from "./SpecRun/RunOpener.ts";
export { type JudgedSpecs } from "./SpecRun/JudgeBriefWriter.ts";
export { runText } from "./SpecRun/runState/runText.ts";
export { statePaths } from "./SpecRun/runState/statePaths.ts";
export { reviewPrintoutOf } from "./SpecRun/SessionReviewer.ts";

export class SpecRun extends SpecRunBase {
  static init(config: SpecRunConfig): SpecRun {
    return new SpecRun(config);
  }

  private get statusReporter(): StatusReporter {
    return new StatusReporter(this.config);
  }

  private get runOpener(): RunOpener {
    return new RunOpener(this.config);
  }

  private get sessionReviewer(): SessionReviewer {
    return new SessionReviewer(this.config);
  }

  private get reviewItemDecider(): ReviewItemDecider {
    return new ReviewItemDecider(this.config);
  }

  private get judgeableIssueLister(): JudgeableIssueLister {
    return new JudgeableIssueLister(this.config);
  }

  private get judgeBriefWriter(): JudgeBriefWriter {
    return new JudgeBriefWriter(this.config);
  }

  private get standaloneTicketLister(): StandaloneTicketLister {
    return new StandaloneTicketLister(this.config);
  }

  // One member is a spec's run, a Standalone ticket's included; several are a Batch.
  // Its run loop is built here rather than in a getter, since it holds the member list this call names.
  run(...members: MemberList): Promise<RunResult> {
    return new RunLoop(this.config, members).run();
  }

  requestStop(specIssue: IssueRef): void {
    this.statusReporter.requestStop(specIssue);
  }

  status(specIssue: IssueRef): Promise<string> {
    return this.statusReporter.status(specIssue);
  }

  open(named: MemberList, options: OpenOptions): Promise<OpenResult> {
    return this.runOpener.open(named, options);
  }

  catchUp(holder: LeaseHolder, member: IssueRef): Promise<CatchUp> {
    return this.runOpener.catchUp(holder, member);
  }

  briefReview(issue: IssueRef, options: ReviewOptions): Promise<ReviewResult> {
    return this.sessionReviewer.brief(issue, options);
  }

  submitReview(issue: IssueRef, options: SubmitOptions): Promise<ReviewResult> {
    return this.sessionReviewer.submit(issue, options);
  }

  resolve(issue: IssueRef, options: ResolveOptions): Promise<ReviewResult> {
    return this.sessionReviewer.resolve(issue, options);
  }

  decide(specIssue: IssueRef, decision: ItemDecision): Promise<string> {
    return this.reviewItemDecider.decide(specIssue, decision);
  }

  judgeable(repo: string): Promise<string> {
    return this.judgeableIssueLister.judgeable(repo);
  }

  judgeBrief(repo: string, specs: JudgedSpecs): Promise<string> {
    return this.judgeBriefWriter.judgeBrief(repo, specs);
  }

  standalone(repo: string): Promise<string> {
    return this.standaloneTicketLister.standalone(repo);
  }
}
