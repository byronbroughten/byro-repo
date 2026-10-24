// A session's review: runs review on one ticket's issue workspace outside any run, refusing a workspace another holder
// leases or one with uncommitted changes. Under the ticket budget it saves the findings to the facts file and returns them,
// for the session to resolve itself and hand its records to resolve, which checks them as a run's resolve records are;
// past it, a fresh resolver resolves them. Either way it returns the run's review list to print and posts Halts as a run would.
// Its Halts are numbered S<n>.<k> and returned to print, to be answered in the session rather than on the spec.
// Each step session it starts goes into the ticket's facts file, halted or not.
// ../SpecRun.ts delegates review and resolve to it; its authorship refusal is the Base's, shared with RunLoop.ts.
// It builds its own TicketSequencer, ReviewStepper, LeaseKeeper, ReviewListPoster and HaltRaiser.

import { ActiveAccountUnknown } from "../ActiveAccountUnknown.ts";
import { messageOf } from "../failureText.ts";
import { sessionHaltCountOf } from "../halts.ts";
import {
  holderLabelOf,
  isSameIssue,
  issueLabelOf,
  type IssueRef,
  type LeaseHolder,
  otherLiveHolderOf,
  workspaceLabelOf,
  type WorkspaceStatus,
} from "../IssueWorkspaces.ts";
import { LeaseHeld } from "../LeaseHeld.ts";
import { pairOf } from "../modelFit.ts";
import {
  numberedFindingsOf,
  resolveOutputProblems,
  resolveRecordsOf,
  withReviewerFields,
} from "../resolveStep.ts";
import { ticketReviewListOf } from "../reviewList.ts";
import { RunStop } from "../RunStop.ts";
import { TicketHalted } from "../TicketHalted.ts";
import { latestImplementPeakOf } from "../transcriptFacts.ts";
import { UnhandledStop } from "../UnhandledStop.ts";
import { HaltRaiser } from "./HaltRaiser.ts";
import { LeaseKeeper } from "./LeaseKeeper.ts";
import { ReviewListPoster } from "./ReviewListPoster.ts";
import { ReviewStepper } from "./ReviewStepper.ts";
import {
  haltsOf,
  idListOf,
  recordedSessionsOf,
  type ResolveOptions,
  reviewFactsOf,
  type ReviewOptions,
  type ReviewResult,
  stoppedOnTextOf,
  targetsAtLaunchOf,
  targetsRefusalOf,
  type TicketRun,
  type TicketState,
} from "./runState.ts";
import { SpecRunBase } from "./SpecRunBase.ts";
import { TicketSequencer } from "./TicketSequencer.ts";

interface SessionTicket extends ReviewOptions {
  issue: IssueRef;
  state: TicketState;
  resolvesItself: boolean;
  // Resolve checks uncommitted changes as a broken rule instead.
  isDirtyRefused: boolean;
}

// The workspace's lease decides whether the review takes it.
interface SessionTicketRun extends TicketRun {
  workspace: WorkspaceStatus;
}

export class SessionReviewer extends SpecRunBase {
  private get ticketSequencer(): TicketSequencer {
    return new TicketSequencer(this.config);
  }

  private get reviewStepper(): ReviewStepper {
    return new ReviewStepper(this.config);
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
    const ticketRun = await this._sessionTicketRunOf({
      issue,
      holder,
      // With no implementPeak, a fresh resolver resolves: the implementer is the live interactive session.
      state: { step: "review", sessions: [] },
      resolvesItself: this._isSessionUnderBudget(issue),
      isDirtyRefused: true,
    });
    if (typeof ticketRun === "string") return refusedReviewOf(ticketRun);
    const result = await this._leased(ticketRun, async () => {
      await this.ticketSequencer._runSteps(ticketRun);
      const { state, workspace } = ticketRun;
      if (state.step !== "resolve") return this._finishReview(ticketRun);
      const findings = state.findings ?? [];
      this.factsFile.setPendingResolve(issue, {
        findings,
        base: await this._headsOf(workspace),
      });
      return {
        kind: "findings",
        message: `Reviewed ${issueLabelOf(issue)}, findings: ${findings.length}. Resolve them in this session by \`docs/agents/verdicts.md\`, then hand your records to resolve.`,
        halts: [],
        findings: numberedFindingsOf(findings),
      };
    });
    this._record(ticketRun.run, result.message);
    return result;
  }

  // The session's records pass the run's checker or are refused, naming each rule broken, for the session to correct.
  async resolve(
    issue: IssueRef,
    { holder, output }: ResolveOptions,
  ): Promise<ReviewResult> {
    const pending = this.factsFile.pendingResolveOf(issue);
    if (pending === undefined) {
      return refusedReviewOf(
        `${issueLabelOf(issue)} has no findings waiting on this session; run review first.`,
      );
    }
    const outputProblems = resolveOutputProblems(output);
    if (outputProblems.length > 0) return brokenRulesOf(outputProblems);
    const { findings, base } = pending;
    const ticketRun = await this._sessionTicketRunOf({
      issue,
      holder,
      state: { step: "resolve", sessions: [], findings, resolveBase: base },
      resolvesItself: true,
      isDirtyRefused: false,
    });
    if (typeof ticketRun === "string") return refusedReviewOf(ticketRun);
    const result = await this._leased(ticketRun, async () => {
      const records = withReviewerFields(resolveRecordsOf(output), findings);
      const problems = await this.reviewStepper._resolveProblemsOf(
        ticketRun,
        base,
        records,
      );
      if (problems.length > 0) return brokenRulesOf(problems);
      await this.reviewStepper._keepRecords(ticketRun, {
        resolver: "implementer",
        base,
        records,
      });
      this.factsFile.setPendingResolve(issue, undefined);
      return this._finishReview(ticketRun);
    });
    this._record(ticketRun.run, result.message);
    return result;
  }

  // Unknown when no implement session is recorded or its transcript is missing, which counts as past budget.
  private _isSessionUnderBudget(issue: IssueRef): boolean {
    const sessions = this.factsFile.sessionsOf(issue);
    const peak = sessions && latestImplementPeakOf(sessions);
    return peak !== undefined && peak < this.config.knobs.ticketBudget;
  }

  // A string is the refusal.
  private async _sessionTicketRunOf({
    issue,
    holder,
    state,
    resolvesItself,
    isDirtyRefused,
  }: SessionTicket): Promise<SessionTicketRun | string> {
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
      resolvesItself,
    };
    const workspace = await this.workspaces.find(issue);
    if (workspace === undefined) {
      return `${issueLabelOf(issue)} has no issue workspace; open it with \`npm run issue:start\` first.`;
    }
    const checked = isSameIssue(run.spec.issue, issue) ? [] : [ticket];
    const refusal =
      (await this._authorshipRefusal("the spec and the reviewed ticket", [
        run.spec,
        ...checked,
      ])) ??
      targetsRefusalOf(run, [ticket]) ??
      leaseRefusalOf(workspace, holder) ??
      (isDirtyRefused ? dirtyRefusalOf(workspace) : undefined);
    if (refusal !== undefined) return refusal;
    run.state.tickets[issueLabelOf(issue)] = state;
    return {
      run,
      ticket,
      // Interactive tickets may carry no Model fit.
      pair: pairOf(ticket.body) ?? this.config.knobs.resolverPair,
      workspace,
      state,
      targets: targetsAtLaunchOf(ticket, this._progressPathOf(run)),
    };
  }

  private async _leased(
    ticketRun: SessionTicketRun,
    body: () => Promise<ReviewResult>,
  ): Promise<ReviewResult> {
    try {
      await this.leaseKeeper._takeSessionLease(ticketRun.workspace);
      return await body();
    } catch (error) {
      return reviewEndOf(ticketRun, error);
    } finally {
      await this.leaseKeeper._releaseLeaseOf(ticketRun.ticket.issue);
      this._recordSessions(ticketRun);
    }
  }

  private async _finishReview(ticketRun: TicketRun): Promise<ReviewResult> {
    const { ticket, state } = ticketRun;
    this.factsFile.setReviewFacts(ticket.issue, reviewFactsOf(state));
    await this.reviewListPoster._postCoveredLaterNotes(
      ticket.issue,
      state.resolveRecords ?? [],
    );
    await this.haltRaiser._haltOnUnpostedHalts(ticketRun);
    return {
      kind: "reviewed",
      message: reviewedMessageOf(ticketRun),
      halts: [],
      reviewList: reviewListOf(ticketRun),
    };
  }

  // Beside the implement session, each under the account and config folder it ran as, so wrap-up prices them as review cost.
  private _recordSessions({ run, ticket, state }: TicketRun): void {
    try {
      for (const step of recordedSessionsOf(state)) {
        this.factsFile.addSession(ticket.issue, step);
      }
    } catch (error) {
      // Logged, not thrown, so a failed write never replaces the review's own result.
      this._log(
        run,
        `${issueLabelOf(ticket.issue)}: recording the review's sessions failed: ${messageOf(error)}`,
      );
    }
  }
}

// What `runner review` and `runner resolve` print: the outcome, then the findings or the review list, then each Halt.
export function reviewPrintoutOf({
  message,
  findings,
  reviewList,
  halts,
}: ReviewResult): string {
  const lists = [findings, reviewList].filter((list) => list !== undefined);
  return [message, ...lists, ...halts].join("\n\n");
}

function leaseRefusalOf(
  { key, lease }: WorkspaceStatus,
  holder: LeaseHolder | undefined,
): string | undefined {
  const other = otherLiveHolderOf(lease, holder);
  if (other === undefined) return undefined;
  return `${workspaceLabelOf(key)}'s workspace is leased by ${holderLabelOf(other)}.`;
}

// The resolve step resets the tree when it is killed or capped, so it would lose them.
function dirtyRefusalOf({
  key,
  dirtyRepos,
}: WorkspaceStatus): string | undefined {
  if (dirtyRepos.length === 0) return undefined;
  return `${workspaceLabelOf(key)}'s workspace has uncommitted changes in ${dirtyRepos.join(", ")}; commit them first.`;
}

function refusedReviewOf(message: string): ReviewResult {
  return { kind: "refused", message, halts: [] };
}

function brokenRulesOf(problems: string[]): ReviewResult {
  const rules = problems.map((problem) => `- ${problem}`).join("\n");
  return refusedReviewOf(
    `Your records broke these rules; correct them, committing any fix they need, and resolve again with every finding's record:\n\n${rules}`,
  );
}

function reviewedMessageOf({ ticket, state }: TicketRun): string {
  const { whatReviewCaught } = reviewFactsOf(state);
  const findings = state.findings?.length ?? 0;
  return `Reviewed ${issueLabelOf(ticket.issue)}, findings: ${findings}. ${whatReviewCaught ?? "Nothing to fix or decide."}`;
}

// Undefined when resolve kept no records, or halted before it ran.
function reviewListOf({ ticket, state }: TicketRun): string | undefined {
  return ticketReviewListOf({
    ticket: ticket.issue,
    title: ticket.title,
    records: state.resolveRecords ?? [],
  });
}

function reviewEndOf(ticketRun: TicketRun, error: unknown): ReviewResult {
  const { run, ticket } = ticketRun;
  const label = issueLabelOf(ticket.issue);
  const halts = run.sessionReview?.postedHalts ?? [];
  if (error instanceof TicketHalted) {
    const message = `The review of ${label} halted on Halt ${idListOf(haltsOf(run))}; answer it in this session.`;
    return {
      kind: "halted",
      message,
      halts,
      reviewList: reviewListOf(ticketRun),
    };
  }
  if (error instanceof LeaseHeld) return refusedReviewOf(error.message);
  if (error instanceof ActiveAccountUnknown) {
    return refusedReviewOf(error.message);
  }
  if (error instanceof UnhandledStop) {
    const message = `The review of ${label} ${stoppedOnTextOf(error)}.`;
    return { kind: "stopped", message, halts };
  }
  if (error instanceof RunStop) {
    return { kind: "stopped", message: error.message, halts };
  }
  throw error;
}
