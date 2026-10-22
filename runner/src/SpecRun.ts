// The run loop: takes one spec's tickets, one at a time in blocking-graph order, through implement, review, finding triage,
// fix, checks and wrap-up in each ticket's issue workspace, and never closes the spec; preflight refuses or Stops a run first.
// A blocker, a Halt verdict or a fixer's give-up is a Halt: posted once the ticket's other work is committed, it holds the
// tickets in its scope, and the ticket resumes once every one of its Halts is answered (halts.ts).
// Any outcome a later ticket will handle (red checks, step errors, schema failures) is an UnhandledStop; a red master Stops the run.
// The run holds its ticket's workspace lease; with nothing runnable, an open Halt or another holder's lease leaves it idle, polling.
// requestStop() or a `stop spec` answer ends the run between tickets; status() reads it from outside; review() reviews a session's ticket.
// GitHub and git hold what's durable; a per-spec state file holds the step each ticket reached, so a rerun resumes there.
// Steps launch through AgentStep.ts; prompts are implementStep.ts, reviewStep.ts, findingTriage.ts and fixStep.ts; landing is WrapUp.ts;
// knobs are runKnobs.ts; the review list and gap check are reviewList.ts and gapCheck.ts; shared helpers and run state are SpecRun/.

import {
  copyFileSync,
  existsSync,
  mkdirSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";

import type { StepRequest, StepResult } from "./AgentStep.ts";
import { type WrapUpFacts } from "./FactsFile.ts";
import { commandLabelOf, messageOf } from "./failureText.ts";
import {
  triageOutputSchema,
  triagePrompt,
  type TriageRecord,
  triageRecordProblems,
  triageRecordsOf,
  triageRetryPrompt,
} from "./findingTriage.ts";
import {
  type FixOutcome,
  fixOutcomesOf,
  fixOutputSchema,
  fixPrompt,
  fixRecordProblems,
  type GaveUpOutcome,
  giveUpRecordOf,
} from "./fixStep.ts";
import {
  gapCheckOutputSchema,
  gapCheckPrompt,
  type GapCheckRecord,
  gapCheckRecordOf,
  type GapCheckTicket,
} from "./gapCheck.ts";
import { currentBranchOf, git, saveUncommitted } from "./git.ts";
import {
  answeredNoteOf,
  blockerHaltOf,
  type FailureAnswer,
  failureAnswerOf,
  failureHaltOf,
  failureOptions,
  freshResumeSection,
  guidanceSectionOf,
  type Halt,
  haltCommentOf,
  haltKindLabelOf,
  haltNameOf,
  haltNoticeOf,
  type HaltPost,
  handoffCapDetailOf,
  ignoredNoteOf,
  isRunnersComment,
  isStopSpecAnswer,
  repliesTo,
  resumePrompt,
  runnerMark,
  sessionHaltCommentOf,
  sessionHaltCountOf,
  shortRefOf,
  splitHaltOf,
  type StepFailure,
  triageHaltOf,
} from "./halts.ts";
import {
  type Blocker,
  type Handoff,
  handoffCommentOf,
  handoffOnlyPrompt,
  implementOutputSchema,
  implementPrompt,
  type ImplementRecord,
  implementRecordOf,
  implementRecordProblems,
  moreTurnsPrompt,
  recordOnlyPrompt,
  treeResetNote,
} from "./implementStep.ts";
import { untrustedBodyReasonOf } from "./IssueReader.ts";
import {
  fileStemOf,
  holderLabelOf,
  isSameHolder,
  issueLabelOf,
  type IssueRef,
  type LeaseHolder,
  otherLiveHolderOf,
  type Workspace,
  workspaceLabelOf,
  type WorkspaceStatus,
} from "./IssueWorkspaces.ts";
import { LeaseHeld } from "./LeaseHeld.ts";
import {
  type AccountReading,
  type AccountUsage,
  decideStep,
  defaultLimitGuardKnobs,
} from "./limitGuard.ts";
import {
  mergeMasterOutputSchema,
  mergeMasterPrompt,
} from "./mergeMasterStep.ts";
import {
  nextStrongerPairOf,
  pairLabelOf,
  pairOf,
  strongerPairOf,
} from "./modelFit.ts";
import { redChecksOutputSchema, redChecksPrompt } from "./redChecksStep.ts";
import {
  coveredLaterNotesOf,
  gapCheckListOf,
  gapCheckSubject,
  reviewListMarkOf,
  type ReviewListSubject,
  ticketPushOf,
  ticketReviewListOf,
  undecidedCountOf,
  undecidedLineOf,
} from "./reviewList.ts";
import {
  reviewPrompt,
  type ReviewRecord,
  reviewRecordSchema,
} from "./reviewStep.ts";
import type { RunKnobs } from "./runKnobs.ts";
import { RunStop } from "./RunStop.ts";
import { SchemaFailure } from "./SchemaFailure.ts";
import {
  branchedReposOf,
  type Continuation,
  deliverFailureHalts,
  downstreamIn,
  type Fixer,
  gapCheckLabel,
  haltsOf,
  haltsOfTicket,
  type Heads,
  idListOf,
  implementerSessionOf,
  isFix,
  isGapCheckHalt,
  isLaunchable,
  isSameHeads,
  isSameIssue,
  isSnapshotted,
  isTreeKept,
  isTurnCapped,
  landedTextOf,
  type LandingTicket,
  lastSessionOf,
  launchedOf,
  type LaunchedStep,
  limitReadingOf,
  liveCeilingPhraseOf,
  openHaltsOf,
  raiseHalts,
  type RanStep,
  readyLabel,
  recordOf,
  rerunCommandOf,
  reviewFactsOf,
  type ReviewOptions,
  type ReviewResult,
  type Run,
  runCommand,
  type RunResult,
  type RunWarning,
  schemaFailureOf,
  stoppedOnTextOf,
  targetsAtLaunchOf,
  targetsRefusalOf,
  type TicketRun,
  type TicketState,
  ticketStateOf,
  type TicketStep,
  type TrackedIssue,
  turnCapDetailOf,
  undeliveredHaltsOf,
  type Wait,
  waitsTextOf,
} from "./SpecRun/runState.ts";
import { SpecRunBase, type SpecRunConfig } from "./SpecRun/SpecRunBase.ts";
import { TicketHalted } from "./TicketHalted.ts";
import { minutesOf, percentOf, type StepAgent } from "./transcriptFacts.ts";
import {
  rerunRetriedOutcomes,
  stopOutcomes,
  UnhandledStop,
} from "./UnhandledStop.ts";
import { WrapUpFailure } from "./WrapUpFailure.ts";

export type { Clock, RunGitHub, SpecRunConfig } from "./SpecRun/SpecRunBase.ts";
export {
  type IssueComment,
  rerunCommandOf,
  type ReviewOptions,
  type ReviewResult,
  type RunResult,
  type TicketStep,
  type TrackedIssue,
} from "./SpecRun/runState.ts";

const fixerLabels: Record<Fixer, string> = {
  implementer: "implementer",
  triage: "triage agent",
};
const runHolder: LeaseHolder = { kind: "run", pid: process.pid };

interface TicketReview extends ReviewOptions {
  ticket: TrackedIssue;
}

type StepLaunch = Pick<StepRequest, "prompt" | "jsonSchema"> &
  Partial<
    Pick<
      StepRequest,
      "pair" | "targets" | "resumeSessionId" | "liveCeiling" | "maxTurns"
    >
  >;

type LoggedStepRequest = StepRequest & { logPath: string };

// An adapter that throws leaves the step unrun, which is retried as a crash.
type StepAttempt =
  { kind: "ran"; result: StepResult } | { kind: "unrun"; detail: string };

interface CeilingCrossing {
  ranStep: RanStep;
  headsBefore: Heads;
}

type Crash = Pick<StepFailure, "detail" | "logPath">;

type FixerSession = Pick<StepRequest, "pair" | "resumeSessionId">;

type FixAttempt =
  | { kind: "done"; outcomes: FixOutcome[]; logPath: string }
  | { kind: "crossed"; logPath: string }
  | { kind: "capped" };

interface ImplementTake {
  ticketRun: TicketRun;
  launched: LaunchedStep;
  headsBefore: Heads;
}

interface HoldCheck {
  halt: Halt;
  // `<repo>#<n>`.
  ticket: string;
  downstreamOf: Map<string, string[]>;
}

type TicketOutcome = "landed" | "stopped" | "leased" | "halted";

interface Survey {
  waits: Wait[];
  answered: { ticket: TrackedIssue; at: string }[];
  launchable: TrackedIssue[];
  stoppedAgain?: { ticket: TrackedIssue; stop: string };
}

type Selection =
  | { kind: "launch"; ticket: TrackedIssue }
  | { kind: "stopped-again"; ticket: TrackedIssue; stop: string }
  | { kind: "stop-spec"; halts: Halt[] }
  | { kind: "none"; waits: Wait[] };

export class SpecRun extends SpecRunBase {
  static init(config: SpecRunConfig): SpecRun {
    return new SpecRun(config);
  }

  async run(specIssue: IssueRef): Promise<RunResult> {
    const startedAt = this.config.clock.now();
    // A request left by a stop command with no run going would end this run at its first pick.
    rmSync(this._stopRequestPathOf(specIssue), { force: true });
    const run = await this._startRun(specIssue);
    const launchable = await this._launchableTicketsOf(run);
    const refusal =
      this._authorshipRefusal(run, launchable) ??
      modelFitRefusalOf(run, launchable) ??
      targetsRefusalOf(run, launchable);
    if (refusal !== undefined) {
      this._log(run, `Refused: ${refusal}`);
      return { kind: "refused", landed: [], message: refusal };
    }
    const preflightStop = await this._preflightStop();
    if (preflightStop !== undefined) {
      return this._end(
        run,
        "stopped",
        `Preflight stopped the run: ${preflightStop}`,
      );
    }
    this._log(run, `Preflight passed in ${this._secondsSince(startedAt)}s.`);
    const reading = await this._readingOf(run);
    await this._announce(
      run,
      `Run started on ${run.tickets.length} tickets as ${readingLabelOf(reading)}.`,
    );
    let isIdle = false;
    for (;;) {
      const selection = await this._select(run);
      if (selection.kind === "stop-spec") {
        return this._end(
          run,
          "stopped",
          stopSpecMessageOf(run, selection.halts),
        );
      }
      if (selection.kind === "none") {
        const { waits } = selection;
        if (!waits.some(isIdleWait)) {
          const finished = await this._finish(run, waits);
          if (finished !== undefined) return finished;
          continue;
        }
        if (this._takeStopRequest(run)) return this._stopOnRequest(run, waits);
        if (!isIdle) await this._announce(run, idleMessageOf(waits));
        isIdle = true;
        await this._sleep(this.config.knobs.idlePollMs);
        continue;
      }
      isIdle = false;
      if (this._takeStopRequest(run)) return this._stopOnRequest(run, []);
      if (selection.kind === "stopped-again") {
        const label = issueLabelOf(selection.ticket.issue);
        return this._end(
          run,
          "stopped",
          `${label} is still open after its Stop (${selection.stop}); finish and land it by hand, then rerun.`,
        );
      }
      let outcome: TicketOutcome;
      try {
        outcome = await this._runTicket(run, selection.ticket);
      } catch (error) {
        if (!(error instanceof RunStop)) throw error;
        return this._end(run, "stopped", error.message);
      }
      if (outcome === "leased" || outcome === "halted") continue;
      if (outcome === "stopped") {
        return this._end(
          run,
          "stopped",
          stoppedMessageOf(run, selection.ticket),
        );
      }
      run.landed.push(selection.ticket.issue);
      run.failureStreak = [];
    }
  }

  // Taken once read, so a later run never sees it.
  private _takeStopRequest(run: Run): boolean {
    const path = this._stopRequestPathOf(run.spec.issue);
    if (!existsSync(path)) return false;
    rmSync(path, { force: true });
    return true;
  }

  private _stopOnRequest(run: Run, waits: Wait[]): Promise<RunResult> {
    const message = this._withRerunLine(
      run,
      stopRequestMessageOf(run, waits),
      waits,
    );
    return this._end(run, "stopped", message);
  }

  // A ticketless spec has none; the preflight refusals check the spec itself.
  private async _launchableTicketsOf(run: Run): Promise<TrackedIssue[]> {
    if (run.isTicketless) return [];
    const launchable: TrackedIssue[] = [];
    for (const ticket of run.tickets) {
      const tracked = await this.config.github.issueOf(ticket);
      if (isLaunchable(tracked)) launchable.push(tracked);
    }
    return launchable;
  }

  private _authorshipRefusal(
    run: Run,
    launchable: TrackedIssue[],
  ): string | undefined {
    const { developer } = this.config;
    const offenders = [run.spec, ...launchable].flatMap((issue) => {
      const reason = untrustedBodyReasonOf(developer, issue);
      if (reason === undefined) return [];
      return [`${issueLabelOf(issue.issue)} (${reason})`];
    });
    if (offenders.length === 0) return undefined;
    return `Only ${developer} may write or edit the spec and each open ${readyLabel} ticket; refused ${offenders.join(", ")}.`;
  }

  // Runs no checks: master moves only through wrap-up, which checked the commits it landed.
  private async _preflightStop(): Promise<string | undefined> {
    const { knobs, primaryRoot } = this.config;
    if (knobs.liveCeiling <= knobs.ticketBudget) {
      return `${liveCeilingPhraseOf(knobs)} isn't above the ticket budget of ${knobs.ticketBudget}`;
    }
    for (const command of knobs.authChecks) {
      if ((await runCommand(command, primaryRoot)) !== undefined) {
        return `${commandLabelOf(command)} failed: GitHub auth or the claude login is missing`;
      }
    }
    for (const [repo, clonePath] of Object.entries(knobs.clonePaths)) {
      const clone = join(primaryRoot, clonePath);
      if (!existsSync(join(clone, ".git"))) {
        return `${repo}'s primary clone is missing at ${clone}`;
      }
      const branch = currentBranchOf(clone);
      if (branch !== "master") {
        return `${repo}'s primary checkout is on ${branch || "a detached HEAD"}, not master`;
      }
    }
    return undefined;
  }

  // Read by the run between tickets and while idle; a request made with no run going is dropped as the next run starts.
  requestStop(specIssue: IssueRef): void {
    mkdirSync(this.config.stateFolder, { recursive: true });
    writeFileSync(this._stopRequestPathOf(specIssue), "");
  }

  // Posts nothing and saves no run state, so it's safe beside a live run; an answer the run hasn't read yet shows as open.
  async status(specIssue: IssueRef): Promise<string> {
    const run = await this._startRun(specIssue);
    const openHalts = openHaltsOf(run);
    const { waits } = await this._survey(run, openHalts);
    const landed = run.tickets.filter(
      (ticket) => run.state.tickets[issueLabelOf(ticket)]?.step === "landed",
    );
    const current = waits.flatMap((wait) => currentTextOf(run, wait));
    const others = waits.filter(({ holder }) => holder?.kind !== "run");
    const lines = [
      `${issueLabelOf(specIssue)}, "${run.spec.title}"`,
      `Landed: ${joinedOrNone(landed.map(issueLabelOf))}.`,
      `Current: ${joinedOrNone(current)}.`,
      `Open Halts: ${joinedOrNone(openHalts.map(openHaltTextOf))}.`,
      `Waiting: ${others.length === 0 ? "none" : waitsTextOf(others)}.`,
      `Account: ${readingLabelOf(await this._readingOf(run))}.`,
    ];
    if (existsSync(this._stopRequestPathOf(specIssue))) {
      lines.push("A stop is requested; the run ends after its current ticket.");
    }
    return lines.join("\n");
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
        await this._runnersSpecCommentsOf(run),
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
      this._authorshipRefusal(run, checked) ??
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
      // Past the refusals, a live lease is the caller's own.
      if (otherLiveHolderOf(workspace.lease) === undefined) {
        await this.workspaces.takeLease(workspace, runHolder);
      }
      await this._runSteps(ticketRun);
      this.factsFile.setReviewFacts(issue, reviewFactsOf(ticketRun.state));
      await this._postReviewList(run, ticket);
      await this._haltOnUnpostedHalts(ticketRun);
      return {
        kind: "reviewed",
        message: reviewedMessageOf(ticketRun),
        halts: [],
      };
    } catch (error) {
      return reviewEndOf(ticketRun, error);
    } finally {
      await this._releaseLeaseOf(issue);
    }
  }

  // Read afresh each pick; a ticket with every Halt answered goes first, oldest answered set first, then the frontier.
  private async _select(run: Run): Promise<Selection> {
    await this._postUnpostedHalts(run);
    const stopSpecs = await this._readAnswers(run);
    if (stopSpecs.length > 0) return { kind: "stop-spec", halts: stopSpecs };
    const survey = await this._survey(run, openHaltsOf(run));
    const { waits, answered, launchable, stoppedAgain } = survey;
    if (stoppedAgain !== undefined) {
      return { kind: "stopped-again", ...stoppedAgain };
    }
    answered.sort((first, second) => first.at.localeCompare(second.at));
    const [first] = [...answered.map(({ ticket }) => ticket), ...launchable];
    if (first === undefined) return { kind: "none", waits };
    return { kind: "launch", ticket: first };
  }

  private async _survey(run: Run, openHalts: Halt[]): Promise<Survey> {
    const downstreamOf = await this._scopeDownstreamOf(run, openHalts);
    const survey: Survey = { waits: [], answered: [], launchable: [] };
    const { waits } = survey;
    const gapCheckHalts = openHalts.filter(isGapCheckHalt);
    if (gapCheckHalts.length > 0) {
      const text = `The gap check waits on Halt ${idListOf(gapCheckHalts)}`;
      waits.push({ ticket: run.spec.issue, reason: "halted", text });
    }
    for (const ticket of run.tickets) {
      const tracked = await this.config.github.issueOf(ticket);
      if (!tracked.isOpen) continue;
      const label = issueLabelOf(ticket);
      const holder = await this._otherHolderOf(ticket);
      if (holder !== undefined) {
        const text = `${label} is leased by ${holderLabelOf(holder)}`;
        waits.push({ ticket, reason: "leased", text, holder });
        continue;
      }
      const { step, stop } = ticketStateOf(run, ticket);
      if (stop !== undefined) {
        if (survey.stoppedAgain === undefined) {
          survey.stoppedAgain = { ticket: tracked, stop };
        }
        const text = `${label} stopped on ${stop}`;
        waits.push({ ticket, reason: "stopped", text });
        continue;
      }
      if (run.skipped.has(label)) {
        waits.push({ ticket, reason: "skipped", text: `${label} was skipped` });
        continue;
      }
      const holding = openHalts.filter((halt) =>
        isHeldBy({ halt, ticket: shortRefOf(ticket), downstreamOf }),
      );
      if (holding.length > 0) {
        const text = `${label} waits on Halt ${idListOf(holding)}`;
        waits.push({ ticket, reason: "halted", text });
        continue;
      }
      const stopSpecs = undeliveredHaltsOf(run, ticket).filter(isStopSpec);
      if (stopSpecs.length > 0) {
        const text = `${label}'s Halt ${idListOf(stopSpecs)} was answered \`stop spec\``;
        waits.push({ ticket, reason: "stop-spec", text });
        continue;
      }
      if (!isLaunchable(tracked)) {
        const text = developerWaitTextOf(
          label,
          await this._downstreamLabelsOf(run, ticket),
        );
        waits.push({ ticket, reason: "developer", text });
        continue;
      }
      const blockers = await this.config.github.openBlockersOf(ticket);
      if (blockers.length > 0) {
        const text = `${label} is blocked by ${blockers.map(issueLabelOf).join(", ")}`;
        waits.push({ ticket, reason: "blocked", text });
        continue;
      }
      if (step === "halted") {
        survey.answered.push({
          ticket: tracked,
          at: lastAnswerAtOf(run, ticket),
        });
      } else {
        survey.launchable.push(tracked);
      }
    }
    return survey;
  }

  private async _downstreamLabelsOf(
    run: Run,
    issue: IssueRef,
  ): Promise<string[]> {
    const downstream = await this._downstreamOf(run, issue);
    return run.tickets
      .filter((ticket) => downstream.includes(shortRefOf(ticket)))
      .map(issueLabelOf);
  }

  private _stopRequestPathOf(spec: IssueRef): string {
    return join(this.config.stateFolder, `${fileStemOf(spec)}.stop`);
  }

  // The first reply naming an open Halt answers it; a later one is noted as ignored, once.
  private async _readAnswers(run: Run): Promise<Halt[]> {
    const posted = haltsOf(run).filter(({ isPosted }) => isPosted);
    if (posted.length === 0) return [];
    const stopSpecs: Halt[] = [];
    const comments = await this.config.github.authoredCommentsOf(
      run.spec.issue,
    );
    const { developer } = this.config;
    for (const halt of posted) {
      const [first, ...later] = repliesTo({ halt, comments, developer });
      if (first === undefined) continue;
      if (halt.answer === undefined) {
        halt.answer = {
          replyId: first.id,
          text: first.body,
          at: this.config.clock.now().toISOString(),
        };
        this._saveState(run);
        this._log(
          run,
          `${haltNameOf(halt)} on ${issueLabelOf(halt.ticket)} is answered.`,
        );
        await this._comment(run, answeredNoteOf(halt));
        if (isStopSpec(halt)) stopSpecs.push(halt);
        if (isSkipAnswered(halt) && !isGapCheckHalt(halt)) {
          run.skipped.add(issueLabelOf(halt.ticket));
        }
      }
      const ignored = [first, ...later].filter(
        ({ id }) =>
          id !== halt.answer?.replyId && !halt.ignoredReplies.includes(id),
      );
      for (const reply of ignored) {
        halt.ignoredReplies.push(reply.id);
        this._saveState(run);
        await this._comment(run, ignoredNoteOf(halt, reply));
      }
    }
    return stopSpecs;
  }

  // Each ticket an open Halt names in its scope, to the tickets downstream of it; read only when a Halt names one.
  private async _scopeDownstreamOf(
    run: Run,
    openHalts: Halt[],
  ): Promise<Map<string, string[]>> {
    const named = new Set(
      openHalts.flatMap(({ scope }) => (scope === "spec" ? [] : scope)),
    );
    const downstreamOf = new Map<string, string[]>();
    if (named.size === 0) return downstreamOf;
    const blockersOf = await this._blockersByTicketOf(run);
    named.forEach((ticket) => {
      downstreamOf.set(ticket, downstreamIn({ run, blockersOf, ticket }));
    });
    return downstreamOf;
  }

  // An UnhandledStop leaves the ticket unlanded, commented on and noticed; a lease taken since the pick leaves it waiting.
  private async _runTicket(
    run: Run,
    ticket: TrackedIssue,
  ): Promise<TicketOutcome> {
    const state = ticketStateOf(run, ticket.issue);
    try {
      // Delivered first, so a `rerun on <pair>` answer picks the pair.
      if (state.step === "halted") {
        const { extraTurns } = this.config.knobs;
        state.step =
          deliverFailureHalts(run, { ticket: ticket.issue, extraTurns }) ??
          "resume";
      }
      const pair = state.pair ?? pairOf(ticket.body);
      if (pair === undefined) {
        throw new UnhandledStop(
          "model-fit",
          "The ## Model fit section changed after preflight.",
          this._progressPathOf(run),
        );
      }
      this._log(
        run,
        `${issueLabelOf(ticket.issue)}: launching on ${pairLabelOf(pair)} from ${state.step}.`,
      );
      if (state.step !== "wrap-up") {
        const workspace = await this._timed({ run, ticket }, "workspace", () =>
          this._workspaceFor(run, ticket.issue),
        );
        const targets = targetsAtLaunchOf(ticket, this._progressPathOf(run));
        await this._runSteps({ run, ticket, pair, workspace, state, targets });
      } else {
        const landing = await this.workspaces.find(ticket.issue);
        if (landing) await this._takeLease(run, landing);
      }
      await this._timed({ run, ticket }, "wrap-up", () =>
        this._land({ run, ticket, pair, state }),
      );
      return "landed";
    } catch (error) {
      if (error instanceof LeaseHeld) {
        this._log(run, `${issueLabelOf(ticket.issue)}: ${error.message}`);
        return "leased";
      }
      if (error instanceof TicketHalted) return "halted";
      // Only a run that dies mid-step leaves the marker, so an environment Stop never costs the step its retry.
      state.isStepStarted = undefined;
      this._saveState(run);
      if (!(error instanceof UnhandledStop)) throw error;
      if (isRerunRetried(error)) await this._stopForRerun(run, ticket, error);
      await this._stopTicket(run, ticket, error);
      return "stopped";
    } finally {
      await this._releaseLeaseOf(ticket.issue);
    }
  }

  private async _otherHolderOf(
    issue: IssueRef,
  ): Promise<LeaseHolder | undefined> {
    const lease = (await this.workspaces.find(issue))?.lease;
    return otherLiveHolderOf(lease, runHolder);
  }

  private async _releaseLeaseOf(issue: IssueRef): Promise<void> {
    const workspace = await this.workspaces.find(issue);
    if (workspace?.lease && isSameHolder(workspace.lease, runHolder)) {
      await this.workspaces.releaseLease(workspace);
    }
  }

  private async _takeLease(run: Run, workspace: Workspace): Promise<void> {
    try {
      await this.workspaces.takeLease(workspace, runHolder);
    } catch (error) {
      if (error instanceof LeaseHeld) throw error;
      throw new UnhandledStop(
        "workspace",
        messageOf(error),
        this._progressPathOf(run),
      );
    }
  }

  private async _workspaceFor(run: Run, issue: IssueRef): Promise<Workspace> {
    const existing = await this.workspaces.find(issue);
    if (!existing) {
      const created = await this.workspaces.create(issue);
      await this._takeLease(run, created);
      return created;
    }
    await this._takeLease(run, existing);
    try {
      await this.workspaces.resume(existing);
    } catch (error) {
      throw new UnhandledStop(
        "workspace",
        messageOf(error),
        this._progressPathOf(run),
      );
    }
    this._log(run, `${issueLabelOf(issue)}: resumed ${existing.path}.`);
    return existing;
  }

  // An implementer whose record failed after it committed is offered `retry record`, which keeps those commits.
  private async _runSteps(ticketRun: TicketRun): Promise<void> {
    try {
      await this._runEachStep(ticketRun);
    } catch (error) {
      if (!(error instanceof SchemaFailure)) throw error;
      const { workspace, state } = ticketRun;
      const base = state.implementBase;
      const isImplement = state.step === "implement" || state.step === "resume";
      const failure: StepFailure = {
        step: state.step,
        detail: error.message,
        logPath: error.logPath,
      };
      if (
        isImplement &&
        base !== undefined &&
        !isSameHeads(base, await this._headsOf(workspace))
      ) {
        failure.options = [failureOptions.retryRecord, failureOptions.retry];
      }
      await this._failureHalt(ticketRun, failure);
    }
  }

  private async _runEachStep(ticketRun: TicketRun): Promise<void> {
    const { run, state } = ticketRun;
    if (state.isStepStarted) {
      await this._takeCrash(ticketRun, {
        detail: `The run ended during the ${state.step} step.`,
        logPath: this._progressPathOf(run),
      });
    }
    if (state.step === "implement") {
      this._markStepStarted(ticketRun);
      await this._timed(ticketRun, "implement", () =>
        this._implement(ticketRun),
      );
      // A ticket with no code has nothing to review or check.
      const next = state.record?.status === "applied" ? "wrap-up" : "review";
      this._advance(ticketRun, next);
    }
    if (state.step === "resume") {
      this._markStepStarted(ticketRun);
      await this._timed(ticketRun, "resume", () => this._resume(ticketRun));
      this._advance(ticketRun, stepAfterResumeOf(state));
    }
    if (state.step === "review") {
      this._markStepStarted(ticketRun);
      await this._timed(ticketRun, "review", () => this._review(ticketRun));
      const hasFindings = (state.findings ?? []).length > 0;
      this._advance(ticketRun, hasFindings ? "triage" : "checks");
    }
    if (state.step === "triage") {
      this._markStepStarted(ticketRun);
      await this._timed(ticketRun, "triage", () => this._triage(ticketRun));
      const hasFix = (state.triage ?? []).some(isFix);
      this._advance(ticketRun, hasFix ? "fix" : "checks");
    }
    // Checks run after the fixes, so a fix that turns them red gets the red-checks resume.
    if (state.step === "fix") {
      this._markStepStarted(ticketRun);
      await this._timed(ticketRun, "fix", () => this._fix(ticketRun));
      this._advance(ticketRun, "checks");
    }
    if (state.step === "checks") {
      // A session's review leaves the checks and wrap-up to the session.
      if (run.sessionReview !== undefined) return;
      await this._haltOnUnpostedHalts(ticketRun);
      await this._timed(ticketRun, "checks", () => this._check(ticketRun));
      this._advance(ticketRun, "wrap-up");
    }
  }

  // Snapshots a step that edits; a crash past the retries is a Failure Halt.
  private async _takeCrash(ticketRun: TicketRun, crash: Crash): Promise<void> {
    const { run, ticket, state } = ticketRun;
    const { step } = state;
    const { detail } = crash;
    if (isSnapshotted(step)) await this._snapshot(ticketRun, step);
    state.crashes ??= {};
    const taken = state.crashes[step] ?? 0;
    const { retriesPerFailure } = this.config.knobs;
    if (taken >= retriesPerFailure) {
      await this._failureHalt(ticketRun, { ...crash, step });
    }
    state.crashes[step] = taken + 1;
    this._saveState(run);
    this._log(
      run,
      `${issueLabelOf(ticket.issue)}: ${detail} Retrying, ${taken + 1} of ${retriesPerFailure}.`,
    );
  }

  private async _failureHalt(
    landingTicket: LandingTicket,
    failure: StepFailure,
  ): Promise<never> {
    const { run, ticket } = landingTicket;
    const downstream = await this._downstreamOf(run, ticket.issue);
    raiseHalts(run, {
      ticket: ticket.issue,
      drafts: [failureHaltOf(failure, downstream)],
    });
    await this._stopIfStuck(landingTicket);
    return this._halt(landingTicket);
  }

  // Posts the last Halt before the Stop, so the developer can answer it.
  private async _stopIfStuck(landingTicket: LandingTicket): Promise<void> {
    const { run, ticket } = landingTicket;
    const label = issueLabelOf(ticket.issue);
    if (!run.failureStreak.includes(label)) run.failureStreak.push(label);
    if (run.failureStreak.length < this.config.knobs.stuckFailureHalts) return;
    await this._postHalts(landingTicket);
    throw new RunStop(
      `Stopped as stuck: ${run.failureStreak.join(", ")} each ended on a Failure Halt in a row; answer them, then rerun.`,
    );
  }

  private async _implement(ticketRun: TicketRun): Promise<void> {
    await this._runImplement(ticketRun, () => this._freshLaunchOf(ticketRun));
  }

  // Each handoff launches a fresh implement step, until one returns another record.
  private async _runImplement(
    ticketRun: TicketRun,
    launchOf: () => StepLaunch,
    onLaunched: () => void = () => {},
  ): Promise<void> {
    let record = await this._runImplementStep(ticketRun, launchOf, onLaunched);
    while (record.status === "handoff") {
      await this._handOff(ticketRun, record.handoff);
      record = await this._runImplementStep(ticketRun, () =>
        this._freshLaunchOf(ticketRun),
      );
    }
  }

  private _freshLaunchOf(ticketRun: TicketRun): StepLaunch {
    return {
      prompt: this._implementPromptOf(ticketRun),
      jsonSchema: implementOutputSchema,
    };
  }

  // A continuation keeps the earlier base, so the commits it already made still count as new.
  private async _runImplementStep(
    ticketRun: TicketRun,
    launchOf: () => StepLaunch,
    onLaunched: () => void = () => {},
  ): Promise<ImplementRecord> {
    const { run, workspace, state } = ticketRun;
    const { continuation } = state;
    const { liveCeiling } = this.config.knobs;
    let launch: StepLaunch;
    if (continuation === undefined || state.implementBase === undefined) {
      if (state.latestHandoff !== undefined) {
        await this._haltBeforeFreshStep(ticketRun, state.latestHandoff);
      }
      state.implementBase = await this._headsOf(workspace);
      this._saveState(run);
      launch = { ...launchOf(), liveCeiling };
    } else {
      launch = continuationLaunchOf(state, continuation, liveCeiling);
    }
    const headsBefore = state.implementBase;
    const ran = await this._runStep(ticketRun, "implement", launch);
    state.continuation = undefined;
    onLaunched();
    if (ran.result.hasCrossedCeiling) {
      return this._handOffAtCeiling(ticketRun, { ranStep: ran, headsBefore });
    }
    const launched = launchedOf("implement", ran);
    return this._takeImplementRecord({ ticketRun, launched, headsBefore });
  }

  private async _handOffAtCeiling(
    ticketRun: TicketRun,
    { ranStep, headsBefore }: CeilingCrossing,
  ): Promise<ImplementRecord> {
    const { ticket, state } = ticketRun;
    const ran = await this._runStep(ticketRun, "implement", {
      prompt: handoffOnlyPrompt,
      jsonSchema: implementOutputSchema,
      resumeSessionId: sessionIdOf(
        ticket.issue,
        "implement step past the live ceiling",
        ranStep.result.sessionId,
      ),
    });
    try {
      const launched = launchedOf("implement", ran);
      const { status } = implementRecordOf(launched.record);
      if (status !== "handoff") {
        throw schemaFailureOf(ran.logPath, {
          problems: [`the record is ${status}, not a handoff`],
          output: launched.record,
        });
      }
      return await this._takeImplementRecord({
        ticketRun,
        launched,
        headsBefore,
      });
    } catch (error) {
      if (!(error instanceof SchemaFailure)) throw error;
      await this._snapshot(ticketRun, state.step);
      // Rethrown so the Failure Halt offers `retry record` when the step had committed.
      throw new SchemaFailure(
        `The implement step crossed ${liveCeilingPhraseOf(this.config.knobs)}, and its handoff record failed: ${error.message}`,
        error.logPath,
      );
    }
  }

  // The work stays in the tree for the fresh step; the backup branch is in case that step loses it.
  private async _handOff(
    ticketRun: TicketRun,
    handoff: Handoff,
  ): Promise<void> {
    const { run, ticket, state } = ticketRun;
    const sessionId = sessionIdOf(
      ticket.issue,
      "handoff",
      state.implementerSession,
    );
    const count = (state.handoffCount ?? 0) + 1;
    await this._backUp(ticketRun, `handoff-${count}`, saveUncommitted);
    const comment = handoffCommentOf(handoff, sessionId);
    await this.config.github.comment(ticket.issue, `${runnerMark}\n${comment}`);
    state.handoffCount = count;
    state.latestHandoff = handoff;
    this._saveState(run);
    this._log(run, `${issueLabelOf(ticket.issue)}: handoff ${count}.`);
  }

  // Checked at each fresh step's launch, so a crash or an answer other than `continue +1 handoff` never skips it.
  private async _haltBeforeFreshStep(
    ticketRun: TicketRun,
    { proposedSplit }: Handoff,
  ): Promise<void> {
    const { run, ticket, state } = ticketRun;
    const count = state.handoffCount ?? 0;
    const cap =
      this.config.knobs.handoffsPerTicket + (state.extraHandoffs ?? 0);
    const isSplitUnhalted =
      proposedSplit !== undefined && state.splitHaltedHandoff !== count;
    if (count > cap) {
      if (isSplitUnhalted) state.splitHaltedHandoff = count;
      await this._failureHalt(ticketRun, {
        step: state.step,
        detail: handoffCapDetailOf({
          ticket: ticket.issue,
          count,
          cap,
          slices: isSplitUnhalted ? proposedSplit : [],
        }),
        logPath: this._progressPathOf(run),
        options: [failureOptions.moreHandoffs],
      });
    }
    if (!isSplitUnhalted) return;
    const downstream = await this._downstreamOf(run, ticket.issue);
    raiseHalts(run, {
      ticket: ticket.issue,
      drafts: [splitHaltOf(proposedSplit, downstream)],
    });
    state.splitHaltedHandoff = count;
    await this._haltOnUnpostedHalts(ticketRun);
  }

  private _implementPromptOf({ ticket, workspace, state }: TicketRun): string {
    return implementPrompt({
      issue: ticket.issue,
      title: ticket.title,
      body: ticket.body,
      branch: workspace.branch,
      branchedRepos: workspace.branchedRepos,
      promoteCommand: this.config.promoteCommandOf(ticket.issue),
      allowedWriteGlobs: this.config.knobs.allowedWriteGlobs,
      latestHandoff: state.latestHandoff,
    });
  }

  // Each blocker is a Halt; a blocked record, having committed nothing to review, posts them at once.
  private async _takeImplementRecord({
    ticketRun,
    launched,
    headsBefore,
  }: ImplementTake): Promise<ImplementRecord> {
    const { workspace, state } = ticketRun;
    const record = implementRecordOf(launched.record);
    const { logPath } = launched;
    state.implementPeak = launched.peakContext;
    state.implementerSession = lastSessionOf(state, "implement");
    const hasNewCommit = !isSameHeads(
      headsBefore,
      await this._headsOf(workspace),
    );
    // A resumed ticket whose answers needed no change returns its earlier commits again.
    const isRecommit =
      record.status === "committed" && state.record?.status === "committed";
    const problems = implementRecordProblems(
      record,
      hasNewCommit || isRecommit,
    );
    if (problems.length > 0) {
      throw schemaFailureOf(logPath, {
        problems,
        output: launched.record,
      });
    }
    await this._raiseBlockerHalts(ticketRun, record.blockers);
    if (record.status === "handoff") return record;
    if (record.status === "blocked") {
      await this._haltOnUnpostedHalts(ticketRun);
    }
    state.record = record;
    state.latestHandoff = undefined;
    return record;
  }

  private async _raiseBlockerHalts(
    ticketRun: TicketRun,
    blockers: Blocker[],
  ): Promise<void> {
    if (blockers.length === 0) return;
    const downstream = await this._downstreamOf(
      ticketRun.run,
      ticketRun.ticket.issue,
    );
    raiseHalts(ticketRun.run, {
      ticket: ticketRun.ticket.issue,
      drafts: blockers.map((blocker) => blockerHaltOf(blocker, downstream)),
    });
  }

  // Posts the ticket's new Halts and halts it; with none, the ticket goes on.
  private async _haltOnUnpostedHalts(ticketRun: TicketRun): Promise<void> {
    const { run, ticket } = ticketRun;
    const unposted = haltsOfTicket(run, ticket.issue).filter(
      ({ isPosted }) => !isPosted,
    );
    if (unposted.length === 0) return;
    await this._halt(ticketRun);
  }

  private async _halt(landingTicket: LandingTicket): Promise<never> {
    await this._postHalts(landingTicket);
    throw new TicketHalted(issueLabelOf(landingTicket.ticket.issue));
  }

  private async _postHalts(landingTicket: LandingTicket): Promise<void> {
    this._advance(landingTicket, "halted");
    await this._postUnpostedHalts(landingTicket.run);
  }

  // Also picks up the Halts of a ticket that halted in a run killed before they were all posted.
  private async _postUnpostedHalts(run: Run): Promise<void> {
    // The gap check's is checked first, so it never creates a ticket state for the spec.
    const unposted = haltsOf(run).filter(
      (halt) =>
        !halt.isPosted &&
        (isGapCheckHalt(halt) ||
          ticketStateOf(run, halt.ticket).step === "halted"),
    );
    for (const halt of unposted) {
      const batch = unposted.filter(({ ticket }) =>
        isSameIssue(ticket, halt.ticket),
      );
      const post: HaltPost = {
        halt,
        index: batch.indexOf(halt) + 1,
        count: batch.length,
        ticketTitle: (await this.config.github.issueOf(halt.ticket)).title,
      };
      const { sessionReview } = run;
      const body =
        sessionReview === undefined
          ? haltCommentOf(post)
          : sessionHaltCommentOf(post);
      await this._comment(run, body);
      sessionReview?.postedHalts.push(body);
      halt.isPosted = true;
      this._saveState(run);
      await this._announce(run, haltNoticeOf(post));
    }
  }

  // The resumed implementer gets every answer while its session is under the ticket budget and no handoff is pending; otherwise a fresh agent does.
  private async _resume(ticketRun: TicketRun): Promise<void> {
    const { run, ticket } = ticketRun;
    const halts = undeliveredHaltsOf(run, ticket.issue);
    await this._runImplement(
      ticketRun,
      () => this._resumeLaunchOf(ticketRun, halts),
      () => {
        halts.forEach((halt) => {
          halt.isDelivered = true;
        });
      },
    );
  }

  private _resumeLaunchOf(ticketRun: TicketRun, halts: Halt[]): StepLaunch {
    const { state } = ticketRun;
    const sessionId = implementerSessionOf(state);
    const peak = state.implementPeak ?? Infinity;
    const isUnderBudget = peak < this.config.knobs.ticketBudget;
    const isHandedOff = state.latestHandoff !== undefined;
    if (sessionId !== undefined && isUnderBudget && !isHandedOff) {
      return {
        prompt: resumePrompt(halts),
        resumeSessionId: sessionId,
        jsonSchema: implementOutputSchema,
      };
    }
    // A split Halt's slices may be stale once the developer narrows the ticket, so only its body speaks for them.
    const answered = halts.filter(({ kind }) => kind !== "split");
    if (answered.length === 0) return this._freshLaunchOf(ticketRun);
    return {
      prompt: `${this._implementPromptOf(ticketRun)}\n\n${freshResumeSection(answered)}`,
      jsonSchema: implementOutputSchema,
    };
  }

  private async _review(ticketRun: TicketRun): Promise<void> {
    const { ticket, workspace, state } = ticketRun;
    const { record } = await this._launch(ticketRun, "review", {
      prompt: reviewPrompt({
        issue: ticket.issue,
        title: ticket.title,
        skillName: this.config.knobs.skillNames.review,
        branch: workspace.branch,
        branchedRepos: branchedReposOf(ticketRun),
      }),
      jsonSchema: reviewRecordSchema,
    });
    state.findings = (record as ReviewRecord).findings;
  }

  // Triage never edits, so it runs with no targets; a refused record gets one retry in the same session.
  private async _triage(ticketRun: TicketRun): Promise<void> {
    const { ticket, workspace, state } = ticketRun;
    const findings = state.findings ?? [];
    const launch = {
      pair: this.config.knobs.triagePair,
      targets: [],
      jsonSchema: triageOutputSchema,
    };
    const first = await this._launch(ticketRun, "triage", {
      ...launch,
      prompt: triagePrompt({
        issue: ticket.issue,
        title: ticket.title,
        branch: workspace.branch,
        branchedRepos: branchedReposOf(ticketRun),
        findings,
      }),
    });
    let records = triageRecordsOf(first.record);
    const problems = triageRecordProblems(findings.length, records);
    if (problems.length > 0) {
      const retry = await this._launch(ticketRun, "triage", {
        ...launch,
        prompt: triageRetryPrompt(problems),
        resumeSessionId: lastSessionOf(state, "triage"),
      });
      records = triageRecordsOf(retry.record);
      const retryProblems = triageRecordProblems(findings.length, records);
      if (retryProblems.length > 0) {
        throw schemaFailureOf(retry.logPath, {
          problems: retryProblems,
          output: retry.record,
        });
      }
    }
    state.triage = records;
    raiseHalts(ticketRun.run, {
      ticket: ticketRun.ticket.issue,
      drafts: records
        .filter(isHalt)
        .map((record) => triageHaltOf(record, "verdict")),
    });
  }

  // The resumed implementer fixes under the ticket budget; otherwise, or once killed, the triage agent does.
  private async _fix(ticketRun: TicketRun): Promise<void> {
    const { run, ticket, workspace, state } = ticketRun;
    const fixes = (state.triage ?? []).filter(isFix);
    if (state.fixBase === undefined) {
      state.fixBase = await this._headsOf(workspace);
      this._saveState(run);
    } else {
      await resetTo(workspace, state.fixBase);
    }
    const base = state.fixBase;
    const peak = state.implementPeak ?? Infinity;
    const isUnderBudget = peak < this.config.knobs.ticketBudget;
    let fixer: Fixer = isUnderBudget ? "implementer" : "triage";
    let attempt = await this._runFixer(ticketRun, fixer, fixes);
    if (attempt.kind === "crossed" && fixer === "implementer") {
      await resetTo(workspace, base);
      this._log(
        run,
        `${issueLabelOf(ticket.issue)}: the implementer's fix crossed the live ceiling; handing the batch to the triage agent.`,
      );
      fixer = "triage";
      attempt = await this._runFixer(ticketRun, fixer, fixes);
    }
    if (attempt.kind === "crossed") {
      await resetTo(workspace, base);
      throw new UnhandledStop(
        "step-error",
        `The triage agent's fix crossed ${liveCeilingPhraseOf(this.config.knobs)}; its work is discarded.`,
        attempt.logPath,
      );
    }
    const { heads, dirtyRepos } = await this._headsAndDirtyReposOf(workspace);
    const hasNewCommit = !isSameHeads(base, heads);
    let outcomes: FixOutcome[];
    if (attempt.kind === "capped") {
      // A capped fixer keeps its commits; only its uncommitted work is set aside.
      await this._snapshot(ticketRun, "fix");
      outcomes = fixes.map(({ finding }) => turnCapGiveUpOf(finding));
    } else {
      outcomes = attempt.outcomes;
      const problems = fixRecordProblems({
        fixes,
        outcomes,
        hasNewCommit,
        dirtyRepos,
      });
      if (problems.length > 0) {
        throw schemaFailureOf(attempt.logPath, { problems, output: outcomes });
      }
    }
    const downstream = await this._downstreamOf(run, ticket.issue);
    const gaveUps = outcomes.filter(isGaveUp);
    state.triage = (state.triage ?? []).map((record) => {
      const gaveUp = gaveUps.find(({ finding }) => finding === record.finding);
      if (gaveUp === undefined) return record;
      return giveUpRecordOf({ record, gaveUp, downstream });
    });
    const gaveUpHalts = state.triage.filter(
      (record) =>
        isHalt(record) &&
        gaveUps.some(({ finding }) => finding === record.finding),
    );
    raiseHalts(ticketRun.run, {
      ticket: ticketRun.ticket.issue,
      drafts: gaveUpHalts.map((record) => triageHaltOf(record, "give-up")),
    });
    if (hasNewCommit) state.fixer = fixer;
  }

  private async _runFixer(
    ticketRun: TicketRun,
    fixer: Fixer,
    fixes: TriageRecord[],
  ): Promise<FixAttempt> {
    const { ticket, workspace } = ticketRun;
    const { knobs } = this.config;
    const { result, logPath } = await this._runFixerStep(ticketRun, fixer, {
      liveCeiling: knobs.liveCeiling,
      prompt: fixPrompt({
        issue: ticket.issue,
        title: ticket.title,
        branch: workspace.branch,
        branchedRepos: branchedReposOf(ticketRun),
        fixes,
      }),
      jsonSchema: fixOutputSchema,
    });
    if (result.hasCrossedCeiling) return { kind: "crossed", logPath };
    if (isTurnCapped(result)) return { kind: "capped" };
    const record = recordOf("fix", result, logPath);
    return { kind: "done", outcomes: fixOutcomesOf(record), logPath };
  }

  private async _runFixerStep(
    ticketRun: TicketRun,
    fixer: Fixer,
    launch: StepLaunch,
  ): Promise<RanStep> {
    const ran = await this._runStep(ticketRun, "fix", {
      ...this._fixerSessionOf(ticketRun, fixer),
      ...launch,
    });
    const { state } = ticketRun;
    if (fixer === "implementer") noteImplementerResult(state, ran.result);
    return ran;
  }

  private _fixerSessionOf(
    { pair, state }: TicketRun,
    fixer: Fixer,
  ): FixerSession {
    if (fixer === "implementer") {
      return { pair, resumeSessionId: implementerSessionOf(state) };
    }
    return {
      pair: strongerPairOf(this.config.knobs.triagePair, pair),
      resumeSessionId: lastSessionOf(state, "triage"),
    };
  }

  // The run's tickets this one blocks, directly or through another, each `<repo>#<n>`.
  private async _downstreamOf(run: Run, issue: IssueRef): Promise<string[]> {
    const blockersOf = await this._blockersByTicketOf(run);
    return downstreamIn({ run, blockersOf, ticket: shortRefOf(issue) });
  }

  // Each of the run's tickets, `<repo>#<n>`, to its open blockers.
  private async _blockersByTicketOf(run: Run): Promise<Map<string, string[]>> {
    const blockersOf = new Map<string, string[]>();
    for (const ticket of run.tickets) {
      const blockers = await this.config.github.openBlockersOf(ticket);
      blockersOf.set(shortRefOf(ticket), blockers.map(shortRefOf));
    }
    return blockersOf;
  }

  private async _launch(
    ticketRun: TicketRun,
    agent: StepAgent,
    launch: StepLaunch,
  ): Promise<LaunchedStep> {
    return launchedOf(agent, await this._runStep(ticketRun, agent, launch));
  }

  // A guidance answer goes to the halted step's next launch only, its crash retries included.
  private async _runStep(
    ticketRun: TicketRun,
    agent: StepAgent,
    launch: StepLaunch,
  ): Promise<RanStep> {
    const { state } = ticketRun;
    const ran = await this._retryStep(
      ticketRun,
      agent,
      guidedLaunchOf(launch, state.guidance),
    );
    state.guidance = undefined;
    return ran;
  }

  // Retries a crash, resuming its session when it has one; leaves the result unread, so a fixer can check for a live-ceiling kill before recordOf().
  private async _retryStep(
    ticketRun: TicketRun,
    agent: StepAgent,
    launch: StepLaunch,
  ): Promise<RanStep> {
    let attempt = launch;
    for (;;) {
      const logPath = this._stepLogPathOf(ticketRun, agent);
      const ran = await this._attemptStep(ticketRun, agent, attempt, logPath);
      if (ran.kind === "unrun") {
        await this._takeCrash(ticketRun, { detail: ran.detail, logPath });
        attempt = launch;
        continue;
      }
      const { result } = ran;
      if (isTurnCapped(result)) {
        // A fixer's caller turns what it left unfinished into give-ups.
        if (agent === "fix") return { result, logPath };
        const turns = attempt.maxTurns ?? this.config.knobs.maxTurns[agent];
        const cap = { detail: turnCapDetailOf(agent, turns), logPath };
        if (agent === "implement") {
          return this._haltOnImplementCap(ticketRun, cap);
        }
        await this._takeCrash(ticketRun, cap);
        attempt = launch;
        continue;
      }
      const detail = crashDetailOf(agent, result, this.config.knobs);
      if (detail === undefined) return { result, logPath };
      await this._takeCrash(ticketRun, { detail, logPath });
      if (result.sessionId === undefined) {
        attempt = launch;
      } else {
        attempt = {
          ...launch,
          prompt: retryPromptOf(launch, ticketRun.state),
          resumeSessionId: result.sessionId,
        };
      }
    }
  }

  // Offers more turns, or a stronger pair while there is one.
  private async _haltOnImplementCap(
    ticketRun: TicketRun,
    cap: Crash,
  ): Promise<never> {
    const { pair, state } = ticketRun;
    await this._snapshot(ticketRun, state.step);
    const options = [`\`resume +${this.config.knobs.extraTurns} turns\``];
    const stronger = nextStrongerPairOf(pair);
    if (stronger !== undefined) {
      options.push(`\`rerun on ${pairLabelOf(stronger)}\``);
    }
    return this._failureHalt(ticketRun, { ...cap, step: state.step, options });
  }

  private async _attemptStep(
    ticketRun: TicketRun,
    agent: StepAgent,
    { prompt, jsonSchema, ...overrides }: StepLaunch,
    logPath: string,
  ): Promise<StepAttempt> {
    const { run, ticket, pair, workspace, state, targets } = ticketRun;
    const { knobs } = this.config;
    const usage = await this._waitForLaunch(run);
    if (usage !== undefined) {
      state.limitReadings ??= {};
      state.limitReadings.before ??= limitReadingOf(usage);
    }
    this._log(
      run,
      `${issueLabelOf(ticket.issue)}: ${agent} step, raw stream in ${logPath}.`,
    );
    let result: StepResult;
    try {
      result = await this.config.agentStep.run({
        prompt,
        pair,
        account: knobs.account,
        cwd: workspace.path,
        maxTurns: knobs.maxTurns[agent],
        silenceTimeoutMs: knobs.silenceTimeoutMs,
        wallClockMs: knobs.wallClockMs[agent],
        allowedTools: knobs.allowedTools[agent],
        allowedWriteGlobs: knobs.allowedWriteGlobs,
        targets,
        jsonSchema,
        logPath,
        ...overrides,
      });
    } catch (error) {
      return { kind: "unrun", detail: unrunDetailOf(agent, error) };
    }
    if (result.sessionId !== undefined) {
      state.sessions.push({ agent, sessionId: result.sessionId });
    }
    state.configFolder = result.configFolder ?? state.configFolder;
    this._saveState(run);
    await this._stopOnLimitHit(run, result, logPath);
    return { kind: "ran", result };
  }

  private async _agentResultOf(
    step: string,
    request: LoggedStepRequest,
  ): Promise<StepResult> {
    try {
      return await this.config.agentStep.run(request);
    } catch (error) {
      throw new UnhandledStop(
        "step-error",
        unrunDetailOf(step, error),
        request.logPath,
      );
    }
  }

  // Asks the limit guard about the configured account until it says launch, returning the first reading: a ticket's Limit used before.
  private async _waitForLaunch(run: Run): Promise<AccountUsage | undefined> {
    const { account } = this.config.knobs;
    const knobs = { ...defaultLimitGuardKnobs, ...this.config.limitGuardKnobs };
    let hasAnnouncedWait = false;
    let first: AccountUsage | undefined;
    for (;;) {
      const reading = await this._readingOf(run);
      const { usage } = reading;
      if (usage === undefined) {
        await this._warnOnce(
          run,
          "missing-reading",
          `No usage reading for account ${account}; steps launch unguarded.`,
        );
        return first;
      }
      first ??= usage;
      const decision = decideStep(
        [reading],
        {
          pinnedAccount: account,
          isAtTicketBoundary: true,
          accountChangesToday: 0,
        },
        knobs,
      );
      if (decision.kind === "launch") return first;
      if (decision.kind === "stop") {
        throw new RunStop(
          `Account ${account} is at ${percentOf(usage.sevenDay.utilization)} of its weekly limit, past the reserve; rerun after it resets at ${usage.sevenDay.resetsAt.toISOString()}.`,
        );
      }
      if (decision.kind !== "limitWait") {
        throw new Error(`A one-account run can't ${decision.kind}`);
      }
      if (!hasAnnouncedWait) {
        hasAnnouncedWait = true;
        await this._announce(
          run,
          `Limit wait: account ${account} is at ${percentOf(usage.fiveHour.utilization)} of its 5-hour limit; continuing after ${decision.until.toISOString()}.`,
        );
      }
      const waitMs =
        decision.until.getTime() - this.config.clock.now().getTime();
      await this._sleep(Math.max(waitMs, knobs.limitWaitMarginMs));
    }
  }

  private async _warnOnce(
    run: Run,
    warning: RunWarning,
    summary: string,
  ): Promise<void> {
    if (run.warnings.has(warning)) return;
    run.warnings.add(warning);
    await this._announce(run, summary);
  }

  // The tree stays as is in the workspace; the first stream ever seen is kept for tightening limit detection.
  private async _stopOnLimitHit(
    run: Run,
    { limitHit, exitSubtype, output }: StepResult,
    logPath: string,
  ): Promise<void> {
    const hasSucceeded = exitSubtype === "success" && output.status === "valid";
    // A step that met a limit and still succeeded, as after a retry, isn't stopped.
    if (limitHit === undefined || hasSucceeded) return;
    const { window, resetsAt } = limitHit;
    const savedPath = join(this.config.stateFolder, "first-limit-hit.jsonl");
    if (!existsSync(savedPath) && existsSync(logPath)) {
      copyFileSync(logPath, savedPath);
    }
    if (resetsAt === undefined) {
      await this._warnOnce(
        run,
        "unrecognised-limit-error",
        `Unrecognised limit error on account ${this.config.knobs.account}; the saved stream can tighten detection.`,
      );
      throw new UnhandledStop(
        "limit-hit",
        "The step hit an unrecognised limit error; its reset is unknown.",
        logPath,
      );
    }
    throw new UnhandledStop(
      "limit-hit",
      `The step hit the ${window ?? "usage"} limit; it resets at ${resetsAt.toISOString()}.`,
      logPath,
    );
  }

  // Skips a path already taken, so a crashed step's log survives its retry.
  private _stepLogPathOf(ticketRun: TicketRun, agent: StepAgent): string {
    const folder = this._stepsFolderOf(ticketRun.run);
    const stem = fileStemOf(ticketRun.ticket.issue);
    let index = ticketRun.state.sessions.length + 1;
    // Not shared with git.ts's freeBranchNameOf, which asks git asynchronously and numbers from 2.
    while (existsSync(join(folder, `${stem}-${index}-${agent}.jsonl`))) {
      index += 1;
    }
    return join(folder, `${stem}-${index}-${agent}.jsonl`);
  }

  private _stepsFolderOf(run: Run): string {
    const folder = join(
      this.config.stateFolder,
      `${fileStemOf(run.spec.issue)}-steps`,
    );
    mkdirSync(folder, { recursive: true });
    return folder;
  }

  private async _check(ticketRun: TicketRun): Promise<void> {
    for (;;) {
      const failure = await this._redChecksOf(ticketRun);
      if (failure === undefined) return;
      await this._resumeOnRedChecks(ticketRun, failure);
    }
  }

  // The first failing check's command and output tail; undefined when all pass. A red master Stops the run.
  private async _redChecksOf(
    ticketRun: TicketRun,
  ): Promise<string | undefined> {
    for (const command of this.config.knobs.checks) {
      this._log(
        ticketRun.run,
        `${issueLabelOf(ticketRun.ticket.issue)}: checking ${commandLabelOf(command)}.`,
      );
      const failure = await runCommand(command, ticketRun.workspace.path);
      if (failure !== undefined) {
        await this._stopOnRedMaster(ticketRun);
        return `${commandLabelOf(command)} failed:\n${failure}`;
      }
    }
    return undefined;
  }

  // Whoever made the last commit gets the failure, the triage agent in place of an implementer past the ticket budget.
  private async _resumeOnRedChecks(
    ticketRun: TicketRun,
    failure: string,
  ): Promise<void> {
    const { run, ticket, workspace, state } = ticketRun;
    const { retriesPerFailure, ticketBudget } = this.config.knobs;
    const resumes = state.redCheckResumes ?? 0;
    if (resumes >= retriesPerFailure) {
      await this._failureHalt(ticketRun, {
        step: "checks",
        detail: `The checks are still red after ${resumes} resume(s): ${failure}`,
        logPath: state.redChecksLogPath ?? this._progressPathOf(run),
      });
    }
    state.redCheckResumes = resumes + 1;
    this._saveState(run);
    const peak = state.implementPeak ?? Infinity;
    let fixer: Fixer = state.fixer ?? "implementer";
    if (fixer === "implementer" && peak >= ticketBudget) fixer = "triage";
    this._log(
      run,
      `${issueLabelOf(ticket.issue)}: checks red; resuming the ${fixerLabels[fixer]} with the failure.`,
    );
    this._markStepStarted(ticketRun);
    const { result, logPath } = await this._runFixerStep(ticketRun, fixer, {
      prompt: redChecksPrompt({
        issue: ticket.issue,
        title: ticket.title,
        branch: workspace.branch,
        branchedRepos: branchedReposOf(ticketRun),
        failures: failure,
      }),
      jsonSchema: redChecksOutputSchema,
    });
    state.redChecksLogPath = logPath;
    state.isStepStarted = undefined;
    this._saveState(run);
    // The checks loop judges what a capped fixer committed.
    if (isTurnCapped(result)) {
      await this._snapshot(ticketRun, "checks");
      return;
    }
    recordOf("fix", result, logPath);
  }

  // Checks run in a master set, so neither another session's uncommitted edit nor a local fix hides master's own state.
  private async _stopOnRedMaster({ run, ticket }: TicketRun): Promise<void> {
    const prefix = `Stopped the run at ${issueLabelOf(ticket.issue)}'s checks`;
    let masterSet: string;
    try {
      masterSet = await this.workspaces.masterSet(run.spec.issue);
    } catch (error) {
      throw new RunStop(
        `${prefix}: the master set failed to build: ${messageOf(error)}`,
      );
    }
    for (const command of this.config.knobs.checks) {
      if ((await runCommand(command, masterSet)) !== undefined) {
        throw new RunStop(`${prefix}: master red: ${commandLabelOf(command)}`);
      }
    }
  }

  // Needs no workspace: a wrap-up killed after removing it resumes from its own progress file.
  private async _land(landingTicket: LandingTicket): Promise<void> {
    const { run, ticket, state } = landingTicket;
    const { usage } = await this._readingOf(run);
    if (usage !== undefined) {
      state.limitReadings = {
        ...state.limitReadings,
        after: limitReadingOf(usage),
      };
    }
    this._writeFacts(landingTicket);
    this._log(run, `${issueLabelOf(ticket.issue)}: wrapping up.`);
    for (;;) {
      try {
        await this.wrapUp.run(ticket.issue);
        break;
      } catch (error) {
        await this._takeWrapUpFailure(landingTicket, error);
      }
    }
    this._advance(landingTicket, "landed");
    this._log(run, `${issueLabelOf(ticket.issue)}: landed.`);
    await this._postReviewList(run, ticket);
  }

  // Returns only after the merge-master resume, so the wrap-up runs again; a network failure was already retried with backoff.
  private async _takeWrapUpFailure(
    landingTicket: LandingTicket,
    error: unknown,
  ): Promise<void> {
    const { run, state } = landingTicket;
    const logPath = this._progressPathOf(run);
    if (!(error instanceof WrapUpFailure) || error.kind === "network") {
      throw new UnhandledStop("wrap-up-failure", messageOf(error), logPath);
    }
    const resumes = state.conflictResumes ?? 0;
    if (error.kind === "conflict" && resumes === 0) {
      state.conflictResumes = resumes + 1;
      this._saveState(run);
      await this._mergeMaster(landingTicket, error.message);
      return;
    }
    let detail = error.message;
    if (error.kind === "conflict") {
      detail = `The wrap-up still conflicts after the merge-master resume: ${detail}`;
    }
    await this._failureHalt(landingTicket, {
      step: "wrap-up",
      detail,
      logPath,
    });
  }

  // The rerun wrap-up judges what the session merged, so a turn cap only sets its uncommitted work aside.
  private async _mergeMaster(
    landingTicket: LandingTicket,
    conflict: string,
  ): Promise<void> {
    const { run, ticket } = landingTicket;
    const progressPath = this._progressPathOf(run);
    const workspace = await this.workspaces.find(ticket.issue);
    if (workspace === undefined) {
      throw new UnhandledStop(
        "workspace",
        `${issueLabelOf(ticket.issue)}'s workspace is gone, so master can't be merged into its branch.`,
        progressPath,
      );
    }
    const ticketRun: TicketRun = {
      ...landingTicket,
      workspace,
      targets: targetsAtLaunchOf(ticket, progressPath),
    };
    this._log(
      run,
      `${issueLabelOf(ticket.issue)}: the wrap-up conflicted with master; resuming the implementer to merge it.`,
    );
    const { result, logPath } = await this._runFixerStep(
      ticketRun,
      "implementer",
      {
        prompt: mergeMasterPrompt({
          issue: ticket.issue,
          title: ticket.title,
          branch: workspace.branch,
          branchedRepos: branchedReposOf(ticketRun),
          conflict,
        }),
        jsonSchema: mergeMasterOutputSchema,
      },
    );
    this._saveState(run);
    if (isTurnCapped(result)) {
      await this._snapshot(ticketRun, "wrap-up");
      return;
    }
    try {
      recordOf("merge-master", result, logPath);
    } catch (error) {
      if (!(error instanceof SchemaFailure)) throw error;
      await this._failureHalt(landingTicket, {
        step: "wrap-up",
        detail: error.message,
        logPath: error.logPath,
      });
    }
  }

  // Posts the notes before the comment, so a ticket marked posted has posted both.
  private async _postReviewList(run: Run, ticket: TrackedIssue): Promise<void> {
    const state = ticketStateOf(run, ticket.issue);
    if (state.isReviewListPosted) return;
    const records = state.triage ?? [];
    await this._postCoveredLaterNotes(ticket.issue, records);
    const body = ticketReviewListOf({
      ticket: ticket.issue,
      title: ticket.title,
      records,
    });
    if (body !== undefined && !(await this._hasReviewList(run, ticket.issue))) {
      await this._postReviewListComment(run, ticket.issue, body);
    }
    state.isReviewListPosted = true;
    this._saveState(run);
  }

  // Each checks the later ticket for its mark first, so a rerun never posts it twice.
  private async _postCoveredLaterNotes(
    ticket: IssueRef,
    records: TriageRecord[],
  ): Promise<void> {
    const { github } = this.config;
    for (const note of coveredLaterNotesOf(ticket, records)) {
      const bodies = await github.commentsOf(note.issue);
      if (bodies.some((body) => body.includes(note.mark))) continue;
      await github.comment(note.issue, `${runnerMark}\n${note.body}`);
    }
  }

  // The marker, not run state, is the record: a run killed after posting but before saving finds it.
  private async _hasReviewList(
    run: Run,
    subject: ReviewListSubject,
  ): Promise<boolean> {
    const mark = reviewListMarkOf(subject);
    const comments = await this._runnersSpecCommentsOf(run);
    return comments.some((body) => body.includes(mark));
  }

  private async _runnersSpecCommentsOf(run: Run): Promise<string[]> {
    const comments = await this.config.github.authoredCommentsOf(
      run.spec.issue,
    );
    return comments.filter(isRunnersComment).map(({ body }) => body);
  }

  private async _postReviewListComment(
    run: Run,
    subject: ReviewListSubject,
    body: string,
  ): Promise<void> {
    await this._comment(run, body);
    const { items } = undecidedCountOf([body]);
    if (this.config.knobs.reviewListCadence === "per-ticket" && items > 0) {
      await this._announce(run, ticketPushOf(subject, items));
    }
  }

  private _writeFacts({ run, ticket, pair, state }: LandingTicket): void {
    const { record, configFolder, sessions, limitReadings } = state;
    if (record === undefined) {
      throw new Error(
        `${issueLabelOf(ticket.issue)} reached its wrap-up with no implement record`,
      );
    }
    const facts: WrapUpFacts = {
      closingComment: record.closingComment,
      boxesUndone: record.boxesUndone,
      ...reviewFactsOf(state),
      reviewRounds: 1,
      retries: retriesOf(state),
      pair: pairLabelOf(pair),
      limitReadings,
    };
    const haltKinds = new Set(
      haltsOfTicket(run, ticket.issue).map(({ kind }) => haltKindLabelOf(kind)),
    );
    if (haltKinds.size > 0) facts.halt = [...haltKinds].join(", ");
    if (record.status === "applied") {
      facts.reviewFixes = "skipped";
      facts.reviewRounds = 0;
      facts.githubWrites = record.githubWrites;
    }
    if (configFolder !== undefined) {
      facts.sessions = {
        account: this.config.knobs.account,
        configFolder,
        steps: sessions,
      };
    }
    this.factsFile.write(ticket.issue, facts);
  }

  private async _stopTicket(
    run: Run,
    ticket: TrackedIssue,
    stop: UnhandledStop,
  ): Promise<void> {
    const state = ticketStateOf(run, ticket.issue);
    const outcome = stopOutcomes[stop.outcome];
    state.step = "stopped";
    state.stop = outcome;
    this._saveState(run);
    this._log(
      run,
      `${issueLabelOf(ticket.issue)}: stopped on ${outcome}; details in the spec-issue comment.`,
    );
    await this._comment(
      run,
      [
        stopHeadingOf(ticket, outcome),
        stop.message,
        `Log: \`${stop.logPath}\``,
        "The ticket is left unlanded in its issue workspace, and a rerun won't retry it. Finish and land it by hand with the standalone wrap-up; a rerun skips it once it is closed.",
      ].join("\n\n"),
    );
  }

  // Leaves the ticket at its step, so a rerun retries it.
  private async _stopForRerun(
    run: Run,
    ticket: TrackedIssue,
    stop: UnhandledStop,
  ): Promise<never> {
    const outcome = stopOutcomes[stop.outcome];
    const label = issueLabelOf(ticket.issue);
    const command = rerunCommandOf(this.config.githubOwner, run.spec.issue);
    await this._comment(
      run,
      [
        stopHeadingOf(ticket, outcome),
        stop.message,
        `Log: \`${stop.logPath}\``,
        `The ticket is left at its ${ticketStateOf(run, ticket.issue).step} step in its issue workspace; rerun to retry it: \`${command}\`.`,
      ].join("\n\n"),
    );
    throw new RunStop(`Stopped on ${label}: ${outcome}; rerun to retry it.`);
  }

  // The gap check waits for every ticket to close, since an open one may still land what it would report; undefined once it halts.
  private async _finish(
    run: Run,
    waits: Wait[],
  ): Promise<RunResult | undefined> {
    await this._postLandedReviewLists(run);
    if (waits.length === 0) {
      try {
        await this._gapCheck(run);
      } catch (error) {
        if (error instanceof TicketHalted) return undefined;
        if (error instanceof RunStop) {
          return this._end(run, "stopped", error.message);
        }
        if (!(error instanceof UnhandledStop)) throw error;
        return this._end(
          run,
          "stopped",
          `The gap check ${stoppedOnTextOf(error)}. Rerun to retry it.`,
        );
      }
    }
    const message = this._withRerunLine(
      run,
      endMessageOf(run.landed, waits),
      waits,
    );
    return this._end(
      run,
      "finished",
      await this._withUndecidedLine(run, message),
    );
  }

  // Catches a ticket that landed in a run killed before its review list was posted.
  private async _postLandedReviewLists(run: Run): Promise<void> {
    for (const ticket of run.tickets) {
      const state = run.state.tickets[issueLabelOf(ticket)];
      if (state?.step !== "landed" || state.isReviewListPosted) continue;
      await this._postReviewList(run, await this.config.github.issueOf(ticket));
    }
  }

  // Runs in the primary root on master, where every landed ticket's work is; it reads and writes nothing else.
  private async _gapCheck(run: Run): Promise<void> {
    if (await this._hasReviewList(run, gapCheckSubject)) return;
    const answer = gapCheckAnswerOf(run);
    if (answer?.kind === "skip") {
      deliverGapCheckHalts(run);
      this._saveState(run);
      this._log(run, "The gap check was skipped on its Failure Halt's answer.");
      return;
    }
    const { knobs } = this.config;
    const tickets: GapCheckTicket[] = await Promise.all(
      run.tickets.map((ticket) => this.config.github.issueOf(ticket)),
    );
    let prompt = gapCheckPrompt({
      spec: run.spec.issue,
      title: run.spec.title,
      tickets,
    });
    if (answer?.kind === "guidance") {
      prompt = `${prompt}\n\n${guidanceSectionOf(answer.text)}`;
    }
    const logPath = join(this._stepsFolderOf(run), "gap-check.jsonl");
    const request: LoggedStepRequest = {
      prompt,
      pair: answer?.kind === "rerun" ? answer.pair : knobs.gapCheckPair,
      account: knobs.account,
      cwd: this.config.primaryRoot,
      maxTurns: knobs.maxTurns.gapCheck,
      silenceTimeoutMs: knobs.silenceTimeoutMs,
      wallClockMs: knobs.wallClockMs.gapCheck,
      allowedTools: knobs.allowedTools.gapCheck,
      allowedWriteGlobs: [],
      targets: [],
      jsonSchema: gapCheckOutputSchema,
      logPath,
    };
    let result = await this._runGapCheck(run, request);
    for (
      let retries = 0;
      isTurnCapped(result) && retries < knobs.retriesPerFailure;
      retries += 1
    ) {
      result = await this._runGapCheck(run, request);
    }
    if (isTurnCapped(result)) {
      const detail = turnCapDetailOf(gapCheckLabel, knobs.maxTurns.gapCheck);
      await this._gapCheckHalt(run, { detail, logPath });
    }
    let record: GapCheckRecord;
    try {
      record = gapCheckRecordOf(recordOf(gapCheckLabel, result, logPath));
    } catch (error) {
      if (!(error instanceof SchemaFailure)) throw error;
      return this._gapCheckHalt(run, {
        detail: error.message,
        logPath: error.logPath,
      });
    }
    await this._postReviewListComment(
      run,
      gapCheckSubject,
      gapCheckListOf(run.spec.title, record),
    );
    deliverGapCheckHalts(run);
    this._saveState(run);
  }

  private async _runGapCheck(
    run: Run,
    request: LoggedStepRequest,
  ): Promise<StepResult> {
    await this._waitForLaunch(run);
    this._log(run, `Gap check step, raw stream in ${request.logPath}.`);
    const result = await this._agentResultOf(gapCheckLabel, request);
    await this._stopOnLimitHit(run, result, request.logPath);
    return result;
  }

  // Raised on the spec issue and never counted toward the stuck detector, since the gap check belongs to no ticket.
  private async _gapCheckHalt(
    run: Run,
    failure: Omit<StepFailure, "step">,
  ): Promise<never> {
    deliverGapCheckHalts(run);
    raiseHalts(run, {
      ticket: run.spec.issue,
      drafts: [failureHaltOf({ ...failure, step: "gap-check" }, [])],
    });
    await this._postUnpostedHalts(run);
    throw new TicketHalted(issueLabelOf(run.spec.issue));
  }

  // Counts every review-list comment on the spec, earlier runs' included, since the developer decides them in one place.
  private async _withUndecidedLine(run: Run, message: string): Promise<string> {
    if (this.config.knobs.reviewListCadence !== "end-of-run") return message;
    const count = undecidedCountOf(await this._runnersSpecCommentsOf(run));
    if (count.items === 0) return message;
    return `${message} ${undecidedLineOf(count)}.`;
  }
}

// Discards commits and untracked files alike; ignored files, such as the symlinked configs, stay.

function isHalt({ verdict }: TriageRecord): boolean {
  return verdict === "halt";
}

// The halted ticket itself, every ticket for a `spec` scope, else the named tickets and their downstream.
function isHeldBy({ halt, ticket, downstreamOf }: HoldCheck): boolean {
  const { scope } = halt;
  if (shortRefOf(halt.ticket) === ticket || scope === "spec") return true;
  return scope.some(
    (named) =>
      named === ticket || (downstreamOf.get(named) ?? []).includes(ticket),
  );
}

function lastAnswerAtOf(run: Run, ticket: IssueRef): string {
  const times = undeliveredHaltsOf(run, ticket).map(
    ({ answer }) => answer?.at ?? "",
  );
  return times.sort().at(-1) ?? "";
}

function guidedLaunchOf(
  launch: StepLaunch,
  guidance: string | undefined,
): StepLaunch {
  if (guidance === undefined) return launch;
  return {
    ...launch,
    prompt: `${launch.prompt}\n\n${guidanceSectionOf(guidance)}`,
  };
}

// The latest answer the gap check hasn't acted on; a `stop spec` read on a later run is a skip.
function gapCheckAnswerOf(run: Run): FailureAnswer | undefined {
  const latest = haltsOf(run)
    .filter((halt) => isGapCheckHalt(halt) && !halt.isDelivered)
    .at(-1);
  if (latest?.answer === undefined) return undefined;
  if (isStopSpecAnswer(latest.answer)) return { kind: "skip" };
  return failureAnswerOf(latest, latest.answer);
}

function deliverGapCheckHalts(run: Run): void {
  haltsOf(run)
    .filter(isGapCheckHalt)
    .forEach((halt) => {
      halt.isDelivered = true;
    });
}

function isSkipAnswered(halt: Halt): boolean {
  if (halt.kind !== "failure" || halt.answer === undefined) return false;
  return failureAnswerOf(halt, halt.answer).kind === "skip";
}

// A record-only retry follows commits, which a handoff record can't have, so it gets no live ceiling.
function continuationLaunchOf(
  state: TicketState,
  continuation: Continuation,
  liveCeiling: number,
): StepLaunch {
  const launch = {
    resumeSessionId: lastSessionOf(state, "implement"),
    jsonSchema: implementOutputSchema,
  };
  if (continuation.kind === "record") {
    return { ...launch, prompt: recordOnlyPrompt };
  }
  const { turns } = continuation;
  const prompt = moreTurnsPrompt(turns, !isTreeKept(state));
  return { ...launch, prompt, maxTurns: turns, liveCeiling };
}

// A ticket halted before review has nothing reviewed yet; one with no code has nothing to review.
function stepAfterResumeOf(state: TicketState): TicketStep {
  if (state.record?.status === "applied") return "wrap-up";
  return state.findings === undefined ? "review" : "checks";
}

async function resetTo(workspace: Workspace, heads: Heads): Promise<void> {
  for (const [clonePath, sha] of Object.entries(heads)) {
    const worktree = join(workspace.path, clonePath);
    await git(worktree, "reset", "--hard", sha);
    await git(worktree, "clean", "-fd");
  }
}

// A fix or red-checks step the implementer ran moves its peak and session on.
function noteImplementerResult(
  state: TicketState,
  { peakContext, sessionId }: StepResult,
): void {
  state.implementPeak = peakContext ?? state.implementPeak;
  state.implementerSession = sessionId ?? state.implementerSession;
}

// Undefined for an outcome a caller handles: a live-ceiling kill, a schema failure, success or a turn cap.
function crashDetailOf(
  agent: StepAgent,
  result: StepResult,
  knobs: RunKnobs,
): string | undefined {
  const { hang, errorText, exitSubtype, output } = result;
  if (result.hasCrossedCeiling) return undefined;
  if (hang === "silence") {
    return `The ${agent} step was silent for ${minutesOf(knobs.silenceTimeoutMs)} minutes and was killed.`;
  }
  if (hang === "wall-clock") {
    return `The ${agent} step ran past its ${minutesOf(knobs.wallClockMs[agent])}-minute wall clock and was killed.`;
  }
  if (output.status === "schemaFailure") return undefined;
  if (errorText !== undefined) {
    return `The ${agent} step ended on an error: ${errorText}`;
  }
  if (exitSubtype === undefined) {
    return `The ${agent} step ended without a result.`;
  }
  if (exitSubtype === "error_during_execution") {
    return `The ${agent} step ended ${exitSubtype}.`;
  }
  return undefined;
}

// A crashed backstop resume still owes only its handoff record.
function retryPromptOf(launch: StepLaunch, state: TicketState): string {
  if (launch.prompt === handoffOnlyPrompt) return handoffOnlyPrompt;
  return interruptedPromptOf(state);
}

function interruptedPromptOf(state: TicketState): string {
  let setAside = "";
  if (isSnapshotted(state.step) && !isTreeKept(state)) {
    setAside = ` ${treeResetNote}`;
  }
  return `The previous run was interrupted; continue.${setAside} Nobody is watching this session: never ask a question or wait for an answer.`;
}

function unrunDetailOf(step: string, error: unknown): string {
  return `The ${step} step failed to run: ${messageOf(error)}`;
}

function turnCapGiveUpOf(finding: number): GaveUpOutcome {
  return {
    finding,
    status: "gave-up",
    reason: "turn-cap",
    note: "The fixer hit its turn cap before reporting the finding fixed.",
  };
}

function isGaveUp(outcome: FixOutcome): outcome is GaveUpOutcome {
  return outcome.status === "gave-up";
}

function sessionIdOf(
  issue: IssueRef,
  owner: string,
  sessionId: string | undefined,
): string {
  if (sessionId === undefined) {
    throw new Error(`${issueLabelOf(issue)}'s ${owner} has no session id.`);
  }
  return sessionId;
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

function retriesOf({ crashes = {}, redCheckResumes = 0 }: TicketState): number {
  return Object.values(crashes).reduce(
    (sum, count) => sum + count,
    redCheckResumes,
  );
}

function isRerunRetried({ outcome }: UnhandledStop): boolean {
  return rerunRetriedOutcomes.includes(outcome);
}

function stopHeadingOf(ticket: TrackedIssue, outcome: string): string {
  return `The runner stopped on ${issueLabelOf(ticket.issue)}, "${ticket.title}": ${outcome}.`;
}

// A split spec's own body is never checked; tickets the runner won't launch need no section.
function modelFitRefusalOf(
  run: Run,
  launchable: TrackedIssue[],
): string | undefined {
  if (run.isTicketless) {
    if (pairOf(run.spec.body) !== undefined) return undefined;
    return `${issueLabelOf(run.spec.issue)} has no sub-issues and no valid ## Model fit section: split it with /code-tickets, or add the section.`;
  }
  const offenders = launchable.flatMap(({ issue, body }) =>
    pairOf(body) === undefined ? [issueLabelOf(issue)] : [],
  );
  if (offenders.length === 0) return undefined;
  return `Each open ${readyLabel} ticket needs a ## Model fit section naming one of the five pairs; missing or invalid in ${offenders.join(", ")}.`;
}

function isStopSpec({ answer }: Halt): boolean {
  return answer !== undefined && isStopSpecAnswer(answer);
}

// An open Halt may be answered, and a lease released, while the run waits; anything else needs a rerun.
function isIdleWait({ reason }: Wait): boolean {
  return reason === "halted" || reason === "leased";
}

function developerWaitTextOf(label: string, downstream: string[]): string {
  if (downstream.length === 0) return `${label} waits on you`;
  return `${label} waits on you and blocks ${downstream.join(", ")}`;
}

function joinedOrNone(items: string[]): string {
  return items.length === 0 ? "none" : items.join(", ");
}

function endMessageOf(landed: IssueRef[], waits: Wait[]): string {
  const waitingPart =
    waits.length === 0 ? "Every ticket is closed." : `${waitsTextOf(waits)}.`;
  return `Run ended: ${landedTextOf(landed)}. ${waitingPart}`;
}

function idleMessageOf(waits: Wait[]): string {
  return `Idle: nothing runnable. ${waitsTextOf(waits)}.`;
}

function stopRequestMessageOf(run: Run, waits: Wait[]): string {
  const message = `Stopped on request: ${landedTextOf(run.landed)}.`;
  return waits.length === 0 ? message : `${message} ${waitsTextOf(waits)}.`;
}

function stopSpecMessageOf(run: Run, halts: Halt[]): string {
  const tickets = [...new Set(halts.map(({ ticket }) => issueLabelOf(ticket)))];
  return `Stopped on \`stop spec\` for Halt ${idListOf(halts)}: ${landedTextOf(run.landed)}; ${tickets.join(", ")} stays unlanded.`;
}

function openHaltTextOf(halt: Halt): string {
  return `${halt.id} on ${issueLabelOf(halt.ticket)}`;
}

function currentTextOf(run: Run, { ticket, holder }: Wait): string[] {
  if (holder?.kind !== "run") return [];
  const step = run.state.tickets[issueLabelOf(ticket)]?.step ?? "implement";
  return [`${issueLabelOf(ticket)} at ${step} (${holderLabelOf(holder)})`];
}

function stoppedMessageOf(run: Run, ticket: TrackedIssue): string {
  const { stop } = ticketStateOf(run, ticket.issue);
  return `Stopped on ${issueLabelOf(ticket.issue)}: ${stop ?? "an unhandled outcome"}.`;
}

function readingLabelOf({ account, usage }: AccountReading): string {
  if (usage === undefined) return `account ${account}: no usage reading`;
  return `account ${account}: 5-hour ${percentOf(usage.fiveHour.utilization)}, weekly ${percentOf(usage.sevenDay.utilization)}`;
}
