// A session's review: runs review, triage and fix on one ticket's issue workspace outside any run, refusing a workspace
// another holder leases or one with uncommitted changes, and posts its review list and Halts as a run would.
// ../SpecRun.ts delegates review to it; it builds its own RunLoop (for _authorshipRefusal), TicketSequencer, LeaseKeeper,
// ReviewListPoster and HaltRaiser.

import { sessionHaltCountOf } from "../halts.ts";
import {
  holderLabelOf,
  issueLabelOf,
  type IssueRef,
  type LeaseHolder,
  otherLiveHolderOf,
  workspaceLabelOf,
  type WorkspaceStatus,
} from "../IssueWorkspaces.ts";
import { LeaseHeld } from "../LeaseHeld.ts";
import { pairOf } from "../modelFit.ts";
import { RunStop } from "../RunStop.ts";
import { TicketHalted } from "../TicketHalted.ts";
import { UnhandledStop } from "../UnhandledStop.ts";
import { HaltRaiser } from "./HaltRaiser.ts";
import { LeaseKeeper } from "./LeaseKeeper.ts";
import { ReviewListPoster } from "./ReviewListPoster.ts";
import { RunLoop } from "./RunLoop.ts";
import {
  haltsOf,
  idListOf,
  isSameIssue,
  reviewFactsOf,
  type ReviewOptions,
  type ReviewResult,
  type Run,
  stoppedOnTextOf,
  targetsAtLaunchOf,
  targetsRefusalOf,
  type TicketRun,
  type TrackedIssue,
} from "./runState.ts";
import { SpecRunBase } from "./SpecRunBase.ts";
import { TicketSequencer } from "./TicketSequencer.ts";

interface TicketReview extends ReviewOptions {
  ticket: TrackedIssue;
}

export class SessionReviewer extends SpecRunBase {
  private get runLoop(): RunLoop {
    return new RunLoop(this.config);
  }

  private get ticketSequencer(): TicketSequencer {
    return new TicketSequencer(this.config);
  }

  private get leaseKeeper(): LeaseKeeper {
    return new LeaseKeeper(this.config);
  }

  private get reviewListPoster(): ReviewListPoster {
    return new ReviewListPoster(this.config);
  }

  private get haltRaiser(): HaltRaiser {
    return new HaltRaiser(this.config);
  }

  // Saves no run state and resumes no session, so a later run of the spec is unaffected; runs no checks and no wrap-up.
  async review(
    issue: IssueRef,
    { holder }: ReviewOptions,
  ): Promise<ReviewResult> {
    const { github } = this.config;
    const ticket = await github.issueOf(issue);
    const specIssue = (await github.parentOf(issue))?.issue ?? issue;
    const run = await this._runOf(specIssue, { tickets: {} });
    run.sessionReview = {
      earlierHalts: sessionHaltCountOf(
        issue,
        await this.reviewListPoster._runnersSpecCommentsOf(run),
      ),
      postedHalts: [],
    };
    const result = await this._reviewOne(run, { ticket, holder });
    this._log(run, result.message);
    return result;
  }

  private async _reviewOne(
    run: Run,
    { ticket, holder }: TicketReview,
  ): Promise<ReviewResult> {
    const { issue } = ticket;
    const workspace = await this.workspaces.find(issue);
    if (workspace === undefined) {
      return refusedReviewOf(
        `${issueLabelOf(issue)} has no issue workspace; open it with \`npm run issue:start\` first.`,
      );
    }
    const checked = isSameIssue(run.spec.issue, issue) ? [] : [ticket];
    const refusal =
      this.runLoop._authorshipRefusal(run, checked) ??
      targetsRefusalOf(run, [ticket]) ??
      workspaceRefusalOf(workspace, holder);
    if (refusal !== undefined) return refusedReviewOf(refusal);
    const ticketRun: TicketRun = {
      run,
      ticket,
      // Interactive tickets may carry no Model fit.
      pair: pairOf(ticket.body) ?? this.config.knobs.triagePair,
      workspace,
      // With no implementPeak, the triage agent fixes: the implementer is the live interactive session.
      state: { step: "review", sessions: [] },
      targets: targetsAtLaunchOf(ticket, this._progressPathOf(run)),
    };
    run.state.tickets[issueLabelOf(issue)] = ticketRun.state;
    try {
      await this.leaseKeeper._takeSessionLease(workspace);
      await this.ticketSequencer._runSteps(ticketRun);
      this.factsFile.setReviewFacts(issue, reviewFactsOf(ticketRun.state));
      await this.reviewListPoster._postReviewList(run, ticket);
      await this.haltRaiser._haltOnUnpostedHalts(ticketRun);
      return {
        kind: "reviewed",
        message: reviewedMessageOf(ticketRun),
        halts: [],
      };
    } catch (error) {
      return reviewEndOf(ticketRun, error);
    } finally {
      await this.leaseKeeper._releaseLeaseOf(issue);
    }
  }
}

function workspaceRefusalOf(
  { key, lease, dirtyRepos }: WorkspaceStatus,
  holder: LeaseHolder | undefined,
): string | undefined {
  const label = workspaceLabelOf(key);
  const other = otherLiveHolderOf(lease, holder);
  if (other !== undefined) {
    return `${label}'s workspace is leased by ${holderLabelOf(other)}.`;
  }
  if (dirtyRepos.length === 0) return undefined;
  // The fix step resets the tree when it is killed or capped, so it would lose them.
  return `${label}'s workspace has uncommitted changes in ${dirtyRepos.join(", ")}; commit them first.`;
}

function refusedReviewOf(message: string): ReviewResult {
  return { kind: "refused", message, halts: [] };
}

function reviewedMessageOf({ ticket, state }: TicketRun): string {
  const { whatReviewCaught } = reviewFactsOf(state);
  const findings = state.findings?.length ?? 0;
  return `Reviewed ${issueLabelOf(ticket.issue)}, findings: ${findings}. ${whatReviewCaught ?? "Nothing to fix or decide."}`;
}

function reviewEndOf({ run, ticket }: TicketRun, error: unknown): ReviewResult {
  const label = issueLabelOf(ticket.issue);
  const halts = run.sessionReview?.postedHalts ?? [];
  if (error instanceof TicketHalted) {
    const message = `The review of ${label} halted on Halt ${idListOf(haltsOf(run))}; answer it in this session.`;
    return { kind: "halted", message, halts };
  }
  if (error instanceof LeaseHeld) return refusedReviewOf(error.message);
  if (error instanceof UnhandledStop) {
    const message = `The review of ${label} ${stoppedOnTextOf(error)}.`;
    return { kind: "stopped", message, halts };
  }
  if (error instanceof RunStop) {
    return { kind: "stopped", message: error.message, halts };
  }
  throw error;
}
