// The run loop: takes one spec's tickets, one at a time in blocking-graph order, through implement, review, finding triage,
// fix, checks and wrap-up in each ticket's issue workspace, and never closes the spec; preflight refuses or Stops a run first.
// A blocker, a Halt verdict or a fixer's give-up is a Halt: posted once the ticket's other work is committed, it holds the
// tickets in its scope, and the ticket resumes once every one of its Halts is answered (halts.ts).
// Any outcome a later ticket will handle (red checks, step errors, schema failures) is an UnhandledStop; a red master Stops the run.
// The run holds its ticket's workspace lease; with nothing runnable, an open Halt or another holder's lease leaves it idle, polling.
// requestStop() or a `stop spec` answer ends the run between tickets; status() reads it from outside; review() reviews a session's ticket.
// GitHub and git hold what's durable; a per-spec state file holds the step each ticket reached, so a rerun resumes there.
// Steps launch through AgentStep.ts; landing is WrapUp.ts; knobs are runKnobs.ts; shared helpers, run state, Halts, step
// launches, the implement, review, triage and fix steps, checks and landing, and the review lists and gap check are SpecRun/.

import { existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { commandLabelOf, messageOf } from "./failureText.ts";
import { currentBranchOf } from "./git.ts";
import {
  answeredNoteOf,
  failureAnswerOf,
  failureOptions,
  type Halt,
  haltNameOf,
  ignoredNoteOf,
  isStopSpecAnswer,
  repliesTo,
  sessionHaltCountOf,
  shortRefOf,
  type StepFailure,
} from "./halts.ts";
import { type BodyAuthorship, untrustedBodyReasonOf } from "./IssueReader.ts";
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
import { type AccountReading } from "./limitGuard.ts";
import { pairLabelOf, pairOf } from "./modelFit.ts";
import { RunStop } from "./RunStop.ts";
import { SchemaFailure } from "./SchemaFailure.ts";
import { HaltRaiser } from "./SpecRun/HaltRaiser.ts";
import { ImplementStepper } from "./SpecRun/ImplementStepper.ts";
import { ReviewListPoster } from "./SpecRun/ReviewListPoster.ts";
import { ReviewStepper } from "./SpecRun/ReviewStepper.ts";
import {
  deliverFailureHalts,
  downstreamIn,
  haltsOf,
  haltsOfTicket,
  idListOf,
  isFix,
  isGapCheckHalt,
  isLaunchable,
  isSameHeads,
  isSameIssue,
  landedTextOf,
  type LandingTicket,
  liveCeilingPhraseOf,
  openHaltsOf,
  readyLabel,
  rerunCommandOf,
  reviewFactsOf,
  type ReviewOptions,
  type ReviewResult,
  type Run,
  runCommand,
  type RunResult,
  stoppedOnTextOf,
  targetsAtLaunchOf,
  targetsRefusalOf,
  type TicketRun,
  type TicketState,
  ticketStateOf,
  type TicketStep,
  type TrackedIssue,
  undeliveredHaltsOf,
  type Wait,
  waitsTextOf,
} from "./SpecRun/runState.ts";
import { SpecRunBase, type SpecRunConfig } from "./SpecRun/SpecRunBase.ts";
import { StepLauncher } from "./SpecRun/StepLauncher.ts";
import { TicketLander } from "./SpecRun/TicketLander.ts";
import { TicketHalted } from "./TicketHalted.ts";
import { percentOf } from "./transcriptFacts.ts";
import {
  rerunRetriedOutcomes,
  stopOutcomes,
  UnhandledStop,
} from "./UnhandledStop.ts";

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

const runHolder: LeaseHolder = { kind: "run", pid: process.pid };

interface TicketReview extends ReviewOptions {
  ticket: TrackedIssue;
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

  private get haltRaiser(): HaltRaiser {
    return new HaltRaiser(this.config);
  }

  private get stepLauncher(): StepLauncher {
    return new StepLauncher(this.config);
  }

  private get implementStepper(): ImplementStepper {
    return new ImplementStepper(this.config);
  }

  private get reviewStepper(): ReviewStepper {
    return new ReviewStepper(this.config);
  }

  private get ticketLander(): TicketLander {
    return new TicketLander(this.config);
  }

  private get reviewListPoster(): ReviewListPoster {
    return new ReviewListPoster(this.config);
  }

  async run(specIssue: IssueRef): Promise<RunResult> {
    const startedAt = this.config.clock.now();
    // A request left by a stop command with no run going would end this run at its first pick.
    rmSync(this._stopRequestPathOf(specIssue), { force: true });
    const run = await this._startRun(specIssue);
    const launchable = await this._launchableTicketsOf(run);
    // A ticket with an authorship Halt is left to the launch-time check, which reads the Halt's answer.
    const unhalted = launchable.filter(
      ({ issue }) => !haltsOfTicket(run, issue).some(isAuthorshipHalt),
    );
    const refusal =
      this._authorshipRefusal(run, unhalted) ??
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
          const finished = await this.reviewListPoster._finish(run, waits);
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
    return `${onlyDeveloperEditsTextOf(developer, `the spec and each open ${readyLabel} ticket`)}; refused ${offenders.join(", ")}.`;
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
      await this._releaseLeaseOf(issue);
    }
  }

  // Read afresh each pick; a ticket with every Halt answered goes first, oldest answered set first, then the frontier.
  private async _select(run: Run): Promise<Selection> {
    await this.haltRaiser._postUnpostedHalts(run);
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
    const downstream = await this.haltRaiser._downstreamOf(run, issue);
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
    const blockersOf = await this.haltRaiser._blockersByTicketOf(run);
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
      await this._haltOnUntrustedBody({ run, ticket, pair, state });
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
        this.ticketLander._land({ run, ticket, pair, state }),
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

  private async _haltOnUntrustedBody(
    landingTicket: LandingTicket,
  ): Promise<void> {
    const { run, ticket, state } = landingTicket;
    const { developer } = this.config;
    const unapproved = unapprovedAuthorshipOf({
      developer,
      ticket,
      approved: approvedAuthorshipOf(run, ticket.issue),
    });
    const reason = untrustedBodyReasonOf(developer, unapproved);
    if (reason === undefined) return;
    const { retry, skip } = failureOptions;
    await this.haltRaiser._failureHalt(landingTicket, {
      step: state.step,
      detail: `${issueLabelOf(ticket.issue)}'s body was ${reason}. ${onlyDeveloperEditsTextOf(developer, "a ticket the run launches")}; revert the edit before a ${retry}, or ${skip} the ticket. Either answer approves the edits named here, and only a later edit halts it again.`,
      logPath: this._progressPathOf(run),
      options: [retry, skip],
      untrustedBody: { author: ticket.author, bodyEditors: ticket.bodyEditors },
    });
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
      await this.haltRaiser._failureHalt(ticketRun, failure);
    }
  }

  private async _runEachStep(ticketRun: TicketRun): Promise<void> {
    const { run, state } = ticketRun;
    if (state.isStepStarted) {
      await this.haltRaiser._takeCrash(ticketRun, {
        detail: `The run ended during the ${state.step} step.`,
        logPath: this._progressPathOf(run),
      });
    }
    if (state.step === "implement") {
      this._markStepStarted(ticketRun);
      await this._timed(ticketRun, "implement", () =>
        this.implementStepper._implement(ticketRun),
      );
      // A ticket with no code has nothing to review or check.
      const next = state.record?.status === "applied" ? "wrap-up" : "review";
      this._advance(ticketRun, next);
    }
    if (state.step === "resume") {
      this._markStepStarted(ticketRun);
      await this._timed(ticketRun, "resume", () =>
        this.implementStepper._resume(ticketRun),
      );
      this._advance(ticketRun, stepAfterResumeOf(state));
    }
    if (state.step === "review") {
      this._markStepStarted(ticketRun);
      await this._timed(ticketRun, "review", () =>
        this.reviewStepper._review(ticketRun),
      );
      const hasFindings = (state.findings ?? []).length > 0;
      this._advance(ticketRun, hasFindings ? "triage" : "checks");
    }
    if (state.step === "triage") {
      this._markStepStarted(ticketRun);
      await this._timed(ticketRun, "triage", () =>
        this.reviewStepper._triage(ticketRun),
      );
      const hasFix = (state.triage ?? []).some(isFix);
      this._advance(ticketRun, hasFix ? "fix" : "checks");
    }
    // Checks run after the fixes, so a fix that turns them red gets the red-checks resume.
    if (state.step === "fix") {
      this._markStepStarted(ticketRun);
      await this._timed(ticketRun, "fix", () =>
        this.reviewStepper._fix(ticketRun),
      );
      this._advance(ticketRun, "checks");
    }
    if (state.step === "checks") {
      // A session's review leaves the checks and wrap-up to the session.
      if (run.sessionReview !== undefined) return;
      await this.haltRaiser._haltOnUnpostedHalts(ticketRun);
      await this._timed(ticketRun, "checks", () =>
        this.ticketLander._check(ticketRun),
      );
      this._advance(ticketRun, "wrap-up");
    }
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

function isSkipAnswered(halt: Halt): boolean {
  if (halt.kind !== "failure" || halt.answer === undefined) return false;
  return failureAnswerOf(halt, halt.answer).kind === "skip";
}

// A ticket halted before review has nothing reviewed yet; one with no code has nothing to review.
function stepAfterResumeOf(state: TicketState): TicketStep {
  if (state.record?.status === "applied") return "wrap-up";
  return state.findings === undefined ? "review" : "checks";
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

function onlyDeveloperEditsTextOf(developer: string, bodies: string): string {
  return `Only ${developer} may write or edit ${bodies}`;
}

function isAuthorshipHalt({ untrustedBody }: Halt): boolean {
  return untrustedBody !== undefined;
}

// GitHub keeps every edit in a body's history, so an approval is the latest answered authorship Halt's own record.
function approvedAuthorshipOf(
  run: Run,
  ticket: IssueRef,
): BodyAuthorship | undefined {
  const answered = haltsOfTicket(run, ticket).filter(
    (halt) => halt.answer !== undefined && !isStopSpec(halt),
  );
  return answered.findLast(isAuthorshipHalt)?.untrustedBody;
}

// Each approved edit cancels one edit by the same login, so a login's later edit still counts.
function unapprovedAuthorshipOf({
  developer,
  ticket,
  approved,
}: {
  developer: string;
  ticket: BodyAuthorship;
  approved: BodyAuthorship | undefined;
}): BodyAuthorship {
  if (approved === undefined) return ticket;
  const approvedEditors = [...approved.bodyEditors];
  const bodyEditors = ticket.bodyEditors.filter((editor) => {
    const index = approvedEditors.indexOf(editor);
    if (index === -1) return true;
    approvedEditors.splice(index, 1);
    return false;
  });
  const isAuthorApproved = ticket.author === approved.author;
  return {
    author: isAuthorApproved ? developer : ticket.author,
    bodyEditors,
  };
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
