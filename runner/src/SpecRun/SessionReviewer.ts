// A session's review of one ticket's issue workspace outside any run, which the session runs itself, refusing a workspace
// another holder leases or one with uncommitted changes. The brief returns the run's review prompt and records its start;
// the submit checks the session's review record and its reviewer subagents since the brief, from its transcript, sending
// a short one back once, then saves the findings to the facts file and returns them, for the session to resolve itself
// and hand its records to resolve, which checks them as a run's resolve records are. Resolve returns the run's review
// list to print and posts Halts as a run would; unhalted, it posts the list on the spec too, with no push, or edits the
// one an earlier review posted, keeping its decided items. Its Halts are numbered S<n>.<k> and returned to print.
// The submit and resolve each hold the workspace's lease and an account lease, taken through the launch check, until they end.
// ../SpecRun.ts delegates to it; its authorship refusal is the Base's, shared with PreflightChecker.ts.
// It builds its own ReviewStepper, LeaseKeeper, ReviewListPoster, HaltRaiser and StepLauncher.

import type { ReviewBrief, ReviewFacts } from "../FactsFile.ts";
import { messageOf } from "../failureText.ts";
import { sessionHaltCountOf } from "../halts.ts";
import {
  type IssueRef,
  issueRef,
  type LeaseHolder,
  leaseHolder,
  workspaceKey,
  type WorkspaceStatus,
} from "../IssueWorkspaces.ts";
import { LeaseHeld } from "../LeaseHeld.ts";
import { pairOf } from "../modelFit.ts";
import { bulletListOf, type SessionSubmit } from "../promptText.ts";
import { schemaProblemsOf } from "../recordSchema.ts";
import { ticketReviewListOf } from "../reviewList.ts";
import { RunStop } from "../RunStop.ts";
import type { ReviewRecord } from "../stepRecords.ts";
import { TicketHalted } from "../TicketHalted.ts";
import { spawnedSubagentCountOf } from "../transcriptFacts.ts";
import { UnhandledStop } from "../UnhandledStop.ts";
import { HaltRaiser } from "./HaltRaiser.ts";
import { LeaseKeeper } from "./LeaseKeeper.ts";
import { ReviewListPoster } from "./ReviewListPoster.ts";
import { ReviewStepper } from "./ReviewStepper.ts";
import {
  type ResolveOptions,
  type ReviewOptions,
  type ReviewResult,
  type SubmitOptions,
  type SubmittedSession,
  ticketLaunch,
  type TicketRun,
  type TicketState,
  type TrackedIssue,
} from "./runState.ts";
import { runHalts } from "./runState/runHalts.ts";
import { runText } from "./runState/runText.ts";
import { ticketSteps } from "./runState/ticketSteps.ts";
import { SpecRunBase } from "./SpecRunBase.ts";
import { StepLauncher } from "./StepLauncher.ts";

interface SessionTicket extends ReviewOptions {
  issue: IssueRef;
  state: TicketState;
  // Resolve checks uncommitted changes as a broken rule instead.
  isDirtyRefused: boolean;
}

// The workspace's lease decides whether the review takes it.
interface SessionTicketRun extends TicketRun {
  workspace: WorkspaceStatus;
}

interface SubmittedReview {
  brief: ReviewBrief;
  session: SubmittedSession;
}

export class SessionReviewer extends SpecRunBase {
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

  private get stepLauncher(): StepLauncher {
    return new StepLauncher(this.config);
  }

  // A rerun, for a second review after fixes, overwrites the earlier brief's start.
  async brief(
    issue: IssueRef,
    { holder }: ReviewOptions,
  ): Promise<ReviewResult> {
    const ticketRun = await this._reviewTicketRunOf(issue, holder);
    if (typeof ticketRun === "string") return refusedReviewOf(ticketRun);
    const rules = this._agentStepOf(ticketRun.run.spec, "review");
    const prompt = rules.promptOf({
      ...(await this.reviewStepper._reviewPromptInputOf(ticketRun)),
      sessionSubmit: this._sessionSubmitOf(issue),
      // The interactive session reviews in the session that implemented the ticket (#761).
      isTicketHeld: true,
    });
    this.factsFile.setReviewBrief(issue, {
      startedAt: this.config.clock.now().toISOString(),
    });
    this._record(
      ticketRun.run,
      `Printed ${issueRef.labelOf(issue)}'s review brief.`,
    );
    return { kind: "brief", message: prompt, halts: [] };
  }

  // Saves no run state and launches no session, so a later run of the spec is unaffected; runs no checks and no wrap-up.
  async submit(
    issue: IssueRef,
    { holder, output, session }: SubmitOptions,
  ): Promise<ReviewResult> {
    const brief = this.factsFile.reviewBriefOf(issue);
    if (brief === undefined) {
      return refusedReviewOf(
        `${issueRef.labelOf(issue)} has no review brief to submit against; print it with \`${this._briefCommandOf(issue)}\` and review from it first.`,
      );
    }
    const ticketRun = await this._reviewTicketRunOf(issue, holder);
    if (typeof ticketRun === "string") return refusedReviewOf(ticketRun);
    const rules = this._agentStepOf(ticketRun.run.spec, "review");
    const problems = schemaProblemsOf(rules.outputSchema, output);
    if (problems.length > 0) {
      return refusedReviewOf(
        `Your review record broke its schema; correct it in \`${this._sessionSubmitOf(issue).recordPath}\` and submit again:\n\n${bulletListOf(problems)}`,
      );
    }
    const result = await this._leased(ticketRun, async () => {
      const refusal = await this._sendBackShortReviewOnce(ticketRun, {
        brief,
        session,
      });
      if (refusal !== undefined) return refusedReviewOf(refusal);
      this.factsFile.setReviewBrief(issue, undefined);
      this._recordReviewSession(ticketRun, { brief, session });
      const { state, workspace } = ticketRun;
      const { findings, dismissedOverlaps } = output as ReviewRecord;
      state.findings = findings;
      state.dismissedOverlaps = dismissedOverlaps;
      if (findings.length === 0) return this._finishReview(ticketRun);
      this.factsFile.setPendingResolve(issue, {
        findings,
        base: await this._headsOf(workspace),
        hasSkippedReviewers: state.hasSkippedReviewers,
      });
      return {
        kind: "findings",
        message: `Reviewed ${issueRef.labelOf(issue)}, findings: ${findings.length}. Resolve them in this session by \`docs/agents/verdicts.md\`, then hand your records to resolve.`,
        halts: [],
        findings: this._agentStepOf(
          ticketRun.run.spec,
          "resolve",
        ).numberedFindingsOf(findings),
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
        `${issueRef.labelOf(issue)} has no findings waiting on this session; run review first.`,
      );
    }
    const rules = this._agentStepOf(await this._specOf(issue), "resolve");
    const outputProblems = rules.outputProblems(output);
    if (outputProblems.length > 0) return brokenRulesOf(outputProblems);
    const { findings, base, hasSkippedReviewers } = pending;
    const ticketRun = await this._sessionTicketRunOf({
      issue,
      holder,
      state: {
        step: "resolve",
        sessions: [],
        limitResumes: 0,
        findings,
        resolveBase: base,
        hasSkippedReviewers,
      },
      isDirtyRefused: false,
    });
    if (typeof ticketRun === "string") return refusedReviewOf(ticketRun);
    const result = await this._leased(ticketRun, async () => {
      const records = rules.withReviewerFields(
        rules.recordsOf(output),
        findings,
      );
      const problems = await this.reviewStepper._resolveProblemsOf(
        ticketRun,
        base,
        records,
      );
      if (problems.length > 0) return brokenRulesOf(problems);
      await this.reviewStepper._keepRecords(ticketRun, { base, records });
      this.factsFile.setPendingResolve(issue, undefined);
      return this._finishReview(ticketRun);
    });
    this._record(ticketRun.run, result.message);
    return result;
  }

  private _reviewTicketRunOf(
    issue: IssueRef,
    holder: LeaseHolder | undefined,
  ): Promise<SessionTicketRun | string> {
    return this._sessionTicketRunOf({
      issue,
      holder,
      // With no implementer session, the review hands nothing off: the implementer is the live interactive session.
      state: { step: "review", sessions: [], limitResumes: 0 },
      isDirtyRefused: true,
    });
  }

  private _briefCommandOf({ repo, number }: IssueRef): string {
    return `npm run runner -- review ${this.config.githubOwner}/${repo} ${number}`;
  }

  private _sessionSubmitOf(issue: IssueRef): SessionSubmit {
    const recordPath = `.runner/review-${issue.number}.json`;
    return {
      recordPath,
      command: `${this._briefCommandOf(issue)} ${recordPath} --session <id>`,
    };
  }

  // Over the inline size, a review short of its reviewers since the brief is refused once, then accepted and marked.
  private async _sendBackShortReviewOnce(
    ticketRun: SessionTicketRun,
    { brief, session }: SubmittedReview,
  ): Promise<string | undefined> {
    const { reviewerCheck } = this._agentStepOf(ticketRun.run.spec, "review");
    if (reviewerCheck === undefined) return undefined;
    if (await this.reviewStepper._isInlineAllowed(ticketRun)) return undefined;
    const spawned = spawnedSubagentCountOf(
      session,
      Date.parse(brief.startedAt),
    );
    if (spawned === undefined) {
      return `No transcript for session ${session.sessionId} under ${session.configFolder}; submit with the id on the \`session: <id>\` line in your context, from the session that ran the review.`;
    }
    if (spawned >= reviewerCheck.count) return undefined;
    const { issue } = ticketRun.ticket;
    if (brief.isSentBack === true) {
      this.reviewStepper._markSkippedReviewers(ticketRun, {
        sentBack: "once sent back",
        spawned,
        count: reviewerCheck.count,
      });
      return undefined;
    }
    this.factsFile.setReviewBrief(issue, { ...brief, isSentBack: true });
    const { recordPath, command } = this._sessionSubmitOf(issue);
    return `${reviewerCheck.resumePrompt} Write it to \`${recordPath}\`, replacing the one there, and submit again with \`${command}\`.`;
  }

  // Under the brief's start, so Review cost splits the interactive session there; addSession keeps the first review's start.
  private _recordReviewSession(
    { run, ticket }: TicketRun,
    { brief, session }: SubmittedReview,
  ): void {
    const { sessionId, configFolder, account } = session;
    const label = issueRef.labelOf(ticket.issue);
    if (account === undefined) {
      this._log(
        run,
        `${label}: no Active account could be read, so the review's session ${sessionId} is unrecorded and Review cost won't split at it.`,
      );
      return;
    }
    this.factsFile.addSession(ticket.issue, {
      agent: "review",
      sessionId,
      startedAt: brief.startedAt,
      account,
      configFolder,
    });
  }

  private async _specOf(issue: IssueRef): Promise<TrackedIssue> {
    return this.config.github.issueOf(await this._specIssueOf(issue));
  }

  // A ticket with no parent is its own spec, as a Standalone ticket is.
  private async _specIssueOf(issue: IssueRef): Promise<IssueRef> {
    return (await this.config.github.parentOf(issue))?.issue ?? issue;
  }

  // A string is the refusal.
  private async _sessionTicketRunOf({
    issue,
    holder,
    state,
    isDirtyRefused,
  }: SessionTicket): Promise<SessionTicketRun | string> {
    const { github } = this.config;
    const ticket = await github.issueOf(issue);
    const run = await this._runOf(await this._specIssueOf(issue), {
      tickets: {},
    });
    run.sessionReview = {
      earlierHalts: sessionHaltCountOf(
        issue,
        await this.reviewListPoster._runnersSpecCommentsOf(run),
      ),
      postedHalts: [],
    };
    const workspace = await this.workspaces.find(issue);
    if (workspace === undefined) {
      return `${issueRef.labelOf(issue)} has no issue workspace; open it with \`npm run issue:start\` first.`;
    }
    const pair = pairOf(ticket.body);
    if (pair === undefined) {
      return `${issueRef.labelOf(issue)} has no valid ## Model fit section, so its review has no pair to run on: add one naming one of the six pairs.`;
    }
    const checked = issueRef.isSame(run.spec.issue, issue) ? [] : [ticket];
    const refusal =
      (await this._authorshipRefusal("the spec and the reviewed ticket", [
        run.spec,
        ...checked,
      ])) ??
      ticketLaunch.targetsRefusalOf(run, [ticket]) ??
      leaseRefusalOf(workspace, holder) ??
      (isDirtyRefused ? dirtyRefusalOf(workspace) : undefined);
    if (refusal !== undefined) return refusal;
    run.state.tickets[issueRef.labelOf(issue)] = state;
    return {
      run,
      ticket,
      pair,
      workspace,
      state,
      targets: ticketLaunch.validTargetsOf(ticket, this._progressPathOf(run)),
    };
  }

  private async _leased(
    ticketRun: SessionTicketRun,
    body: () => Promise<ReviewResult>,
  ): Promise<ReviewResult> {
    try {
      await this.leaseKeeper._takeSessionLease(ticketRun.workspace);
      // Taken here, as nothing in the command launches a step to take it lazily.
      await this.stepLauncher._leaseAccount(ticketRun.run);
      return await body();
    } catch (error) {
      return reviewEndOf(ticketRun, error);
    } finally {
      ticketRun.run.accountHold.release();
      await this.leaseKeeper._releaseLeaseOf(ticketRun.ticket.issue);
      this._recordSessions(ticketRun);
    }
  }

  private async _finishReview(ticketRun: TicketRun): Promise<ReviewResult> {
    const { run, ticket, state } = ticketRun;
    const reviewFacts = ticketSteps.reviewFactsOf(
      state,
      this._workflowOf(run.spec),
    );
    this.factsFile.setReviewFacts(ticket.issue, reviewFacts);
    await this.reviewListPoster._postCoveredLaterNotes(
      ticket.issue,
      state.resolveRecords ?? [],
    );
    await this.haltRaiser._haltOnUnpostedHalts(ticketRun);
    // Posted before landing, unlike a run's, so `runner decide` can settle its items before wrap-up reads them.
    await this.reviewListPoster._postSessionReviewList(ticketRun.run, ticket);
    return {
      kind: "reviewed",
      message: reviewedMessageOf(ticketRun, reviewFacts),
      halts: [],
      reviewList: reviewListOf(ticketRun),
    };
  }

  // Beside the implement session, each under the account and config folder it ran as, so wrap-up prices them as review cost.
  private _recordSessions({ run, ticket, state }: TicketRun): void {
    try {
      for (const step of ticketSteps.recordedSessionsOf(state)) {
        this.factsFile.addSession(ticket.issue, step);
      }
    } catch (error) {
      // Logged, not thrown, so a failed write never replaces the review's own result.
      this._log(
        run,
        `${issueRef.labelOf(ticket.issue)}: recording the review's sessions failed: ${messageOf(error)}`,
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
  const other = leaseHolder.otherLiveOf(lease, holder);
  if (other === undefined) return undefined;
  return `${workspaceKey.labelOf(key)}'s workspace is leased by ${leaseHolder.labelOf(other)}.`;
}

// The resolve step resets the tree when it is killed or capped, so it would lose them.
function dirtyRefusalOf({
  key,
  dirtyRepos,
}: WorkspaceStatus): string | undefined {
  if (dirtyRepos.length === 0) return undefined;
  return `${workspaceKey.labelOf(key)}'s workspace has uncommitted changes in ${dirtyRepos.join(", ")}; commit them first.`;
}

function refusedReviewOf(message: string): ReviewResult {
  return { kind: "refused", message, halts: [] };
}

function brokenRulesOf(problems: string[]): ReviewResult {
  const rules = bulletListOf(problems);
  return refusedReviewOf(
    `Your records broke these rules; correct them, committing any fix they need, and resolve again with every finding's record:\n\n${rules}`,
  );
}

function reviewedMessageOf(
  { ticket, state }: TicketRun,
  { whatReviewCaught }: ReviewFacts,
): string {
  const findings = state.findings?.length ?? 0;
  return `Reviewed ${issueRef.labelOf(ticket.issue)}, findings: ${findings}. ${whatReviewCaught ?? "Nothing to fix or decide."}`;
}

// Undefined when resolve kept no records, or halted before it ran.
function reviewListOf({ ticket, state }: TicketRun): string | undefined {
  return ticketReviewListOf({
    ticket: ticket.issue,
    title: ticket.title,
    records: state.resolveRecords ?? [],
    hasSkippedReviewers: state.hasSkippedReviewers,
  });
}

function reviewEndOf(ticketRun: TicketRun, error: unknown): ReviewResult {
  const { run, ticket } = ticketRun;
  const label = issueRef.labelOf(ticket.issue);
  const halts = run.sessionReview?.postedHalts ?? [];
  if (error instanceof TicketHalted) {
    const message = `The review of ${label} halted on Halt ${runHalts.idListOf(runHalts.of(run))}; answer it in this session.`;
    return {
      kind: "halted",
      message,
      halts,
      reviewList: reviewListOf(ticketRun),
    };
  }
  if (error instanceof LeaseHeld) {
    return refusedReviewOf(error.message);
  }
  if (error instanceof UnhandledStop) {
    const message = `The review of ${label} ${runText.stoppedOn(error)}.`;
    return { kind: "stopped", message, halts };
  }
  if (error instanceof RunStop) {
    return { kind: "stopped", message: error.message, halts };
  }
  throw error;
}
