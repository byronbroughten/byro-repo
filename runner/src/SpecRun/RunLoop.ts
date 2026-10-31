// The run loop works a list of members, one Run each, and holds each one's RunLock while it runs; several are a Batch.
// Preflight refuses or Stops a run first: a per-Run part collects every Run's refusal, and a shared part runs once.
// Then it picks tickets one at a time across members and runs each, a member held by a Halt stepping aside,
// idling while open Halts and other holders' leases are all that's in the way, until every member is done or something Stops it.
// Any outcome a later ticket will handle (red checks, step errors, schema failures) is an UnhandledStop; a red master Stops the run.
// requestStop() ends the run between tickets, and a `stop spec` answer its own member; status() reads it from outside.
// A landing that changes the runner's own source ends it restarting, for tmux.sh to relaunch.
// ../SpecRun.ts delegates run, status and requestStop to it.
// It builds its own TicketSelector, TicketSequencer and ReviewListPoster.

import { existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import {
  ActiveAccountUnknown,
  noActiveAccountPhraseOf,
} from "../ActiveAccountUnknown.ts";
import { commandLabelOf } from "../failureText.ts";
import { currentBranchOf, git } from "../git.ts";
import { type Halt } from "../halts.ts";
import {
  fileStemOf,
  holderLabelOf,
  issueLabelOf,
  type IssueRef,
} from "../IssueWorkspaces.ts";
import { type AccountReading, readingLabelOf } from "../limitGuard.ts";
import { localTimeOf } from "../localTime.ts";
import { pairOf } from "../modelFit.ts";
import { type HeldRunLock, RunLock } from "../RunLock.ts";
import { RunStop } from "../RunStop.ts";
import { stalePathLabelOf, stalePathsOf } from "../stalePaths.ts";
import {
  type Member,
  type MemberSelection,
  MemberSelections,
} from "./MemberSelections.ts";
import { ReviewListPoster } from "./ReviewListPoster.ts";
import {
  idListOf,
  isLanded,
  isLaunchable,
  landedTextOf,
  liveCeilingPhraseOf,
  type MemberList,
  openHaltsOf,
  readyLabel,
  rerunCommandOf,
  type Run,
  runCommand,
  type RunResult,
  targetsRefusalOf,
  type TicketOutcome,
  type TrackedIssue,
  type Wait,
  waitsTextOf,
} from "./runState.ts";
import { type RunEvent, SpecRunBase } from "./SpecRunBase.ts";
import { TicketSelector } from "./TicketSelector.ts";
import { TicketSequencer } from "./TicketSequencer.ts";

// Non-empty, so the run always has a first Run to tell what concerns it as a whole.
type RunList<RN> = [RN, ...RN[]];

interface RunStart {
  reading: AccountReading;
  // The launch the first pick makes, if it makes one.
  launch: MemberSelection<"launch"> | undefined;
  isRelaunch: boolean;
}

type LocksTaken =
  { kind: "taken"; locks: RunLock[] } | { kind: "refused"; refusals: string[] };

// A Stop's message, and the event on the member it came from.
interface MemberStop {
  member: Member;
  message: string;
  event?: RunEvent;
}

type Finishing =
  | { kind: "none" }
  | { kind: "finishing" }
  | { kind: "stopped"; stop: MemberStop };

export class RunLoop extends SpecRunBase {
  private get ticketSelector(): TicketSelector {
    return new TicketSelector(this.config);
  }

  private get ticketSequencer(): TicketSequencer {
    return new TicketSequencer(this.config);
  }

  private get reviewListPoster(): ReviewListPoster {
    return new ReviewListPoster(this.config);
  }

  async run(memberIssues: MemberList): Promise<RunResult> {
    const taken = this._takeRunLocks(memberIssues);
    // Announced, the refusal would land in the live run's event file as its run-ended line.
    if (taken.kind === "refused") {
      return refusedOf(taken.refusals);
    }
    try {
      return await this._runHoldingLocks(memberIssues);
    } finally {
      taken.locks.forEach((lock) => lock.release());
    }
  }

  // The per-Run preflight's first check; no lock is kept unless every one is taken.
  private _takeRunLocks(memberIssues: IssueRef[]): LocksTaken {
    const locks: RunLock[] = [];
    const refusals: string[] = [];
    memberIssues.forEach((memberIssue) => {
      const taken = RunLock.take(this.config.stateFolder, memberIssue);
      if (taken.kind === "held") {
        refusals.push(runLockRefusalOf(memberIssue, taken));
      } else {
        locks.push(taken.lock);
      }
    });
    if (refusals.length === 0) return { kind: "taken", locks };
    locks.forEach((lock) => lock.release());
    return { kind: "refused", refusals };
  }

  // A member ends on its own, by finishing or a `stop spec`, while the others carry on; a Stop ends every unfinished one.
  private async _runHoldingLocks(memberIssues: MemberList): Promise<RunResult> {
    const startedAt = this.config.clock.now();
    const runs = await this._startRuns(memberIssues);
    // Each Run's restart is taken, whichever relaunches, so no later rerun reads one again.
    let isRelaunch = false;
    runs.forEach((run) => {
      if (this._takeRestart(run)) isRelaunch = true;
    });
    const refusals = await this._runRefusalsOf(runs);
    if (refusals.length > 0) return refusedOf(refusals);
    const members = membersOf(runs);
    // The account and the primary checkout concern every member alike; the first member reads them.
    const [lead] = members;
    const preflightStop = await this._preflightStop();
    if (preflightStop !== undefined) {
      return this._stopAll(members, {
        member: lead,
        message: `Preflight stopped the run: ${preflightStop}`,
      });
    }
    runs.forEach((run) => {
      this._log(run, `Preflight passed in ${this._secondsSince(startedAt)}s.`);
    });
    let reading: AccountReading;
    try {
      reading = await this._activeReadingOf(lead.run);
    } catch (error) {
      if (!(error instanceof RunStop)) throw error;
      return this._stopAll(members, { member: lead, message: error.message });
    }
    const startHead = await git(this.config.primaryRoot, "rev-parse", "HEAD");
    let isStartAnnounced = false;
    let isIdle = false;
    for (;;) {
      const unfinished = members.filter(({ end }) => end === undefined);
      if (unfinished.length === 0) return this._resultOf(members);
      const selections = await this._selectEach(unfinished);
      const launch = selections.nextLaunch;
      if (!isStartAnnounced) {
        await this._announceStart(unfinished, { reading, launch, isRelaunch });
        isStartAnnounced = true;
      }
      if (await this._endStopSpecs(selections.stopSpecs)) continue;
      const { waiting } = selections;
      const finishing = await this._finishUnheld(waiting);
      if (finishing.kind === "stopped") {
        return this._stopAll(members, finishing.stop);
      }
      if (finishing.kind === "finishing") continue;
      if (this._takeStopRequest(runs)) {
        return this._stopOnRequest(members, waiting);
      }
      const { stoppedAgain } = selections;
      if (stoppedAgain !== undefined) {
        const { member, ticket, stop } = stoppedAgain;
        const label = issueLabelOf(ticket.issue);
        await this._stopMember({
          member,
          message: `${label} is still open after its Stop (${stop}); finish and land it by hand, then rerun.`,
          event: { ticket: ticket.issue },
        });
        continue;
      }
      if (launch === undefined) {
        if (!isIdle) await this._announceIdle(waiting);
        isIdle = true;
        await this._sleep(this.config.knobs.idlePollMs);
        continue;
      }
      isIdle = false;
      const { member, ticket } = launch;
      const { run } = member;
      let outcome: TicketOutcome;
      try {
        outcome = await this.ticketSequencer._runTicket(run, ticket);
      } catch (error) {
        if (!(error instanceof RunStop)) throw error;
        return this._stopAll(members, {
          member,
          message: error.message,
          event: error.event,
        });
      }
      if (outcome === "leased" || outcome === "halted") continue;
      run.landed.push(ticket.issue);
      run.failureStreak = [];
      if (await this._hasRunnerChangedSince(startHead)) {
        return this._restart(members, ticket.issue);
      }
    }
  }

  private _startRuns(memberIssues: MemberList): Promise<RunList<Run>> {
    const [first, ...rest] = memberIssues;
    return Promise.all([
      this._startRunClearingStop(first),
      ...rest.map((specIssue) => this._startRunClearingStop(specIssue)),
    ]);
  }

  private async _startRunClearingStop(specIssue: IssueRef): Promise<Run> {
    // A request left by a stop command with no run going would end this run at its first pick.
    rmSync(this._stopRequestPathOf(specIssue), { force: true });
    return this._startRun(specIssue);
  }

  // The per-Run preflight's spec checks, each Run's refusal announced on its own Run and every one returned.
  private async _runRefusalsOf(runs: Run[]): Promise<string[]> {
    const refusals: string[] = [];
    for (const run of runs) {
      const refusal = await this._runRefusalOf(run);
      if (refusal === undefined) continue;
      await this._announce(run, `Refused: ${refusal}`, { kind: "refused" });
      refusals.push(refusal);
    }
    return refusals;
  }

  private async _runRefusalOf(run: Run): Promise<string | undefined> {
    const launchable = await this._launchableTicketsOf(run);
    // A ticket's body is left to the launch-time check, whose Halt can approve it.
    return (
      (await this._authorshipRefusal("the spec", [run.spec])) ??
      modelFitRefusalOf(run, launchable) ??
      targetsRefusalOf(run, launchable)
    );
  }

  // Every member is read, since a `stop spec` answer is returned only by the pick that reads it, and answers are ordered across members.
  private async _selectEach(members: Member[]): Promise<MemberSelections> {
    const selections: MemberSelection[] = [];
    for (const member of members) {
      const selection = await this.ticketSelector._select(member.run);
      selections.push({ member, ...selection });
    }
    return new MemberSelections(selections);
  }

  // A `stop spec` ends its own member only; true when one did.
  private async _endStopSpecs(
    stopSpecs: MemberSelection<"stop-spec">[],
  ): Promise<boolean> {
    for (const { member, halts } of stopSpecs) {
      const message = stopSpecMessageOf(member.run, halts);
      await this._stopMember({ member, message });
    }
    return stopSpecs.length > 0;
  }

  // A member with no Halt or lease to wait out is done for this run; finishing when one was finished or its gap check halted.
  private async _finishUnheld(
    waiting: MemberSelection<"none">[],
  ): Promise<Finishing> {
    const unheld = waiting.filter(({ waits }) => !waits.some(isIdleWait));
    for (const { member, waits } of unheld) {
      let result: RunResult | undefined;
      try {
        result = await this.reviewListPoster._finish(member.run, waits);
      } catch (error) {
        if (!(error instanceof RunStop)) throw error;
        const { message, event } = error;
        return { kind: "stopped", stop: { member, message, event } };
      }
      if (result === undefined) continue;
      member.end = {
        result,
        isLanded: result.kind === "finished" && waits.length === 0,
      };
    }
    if (unheld.length === 0) return { kind: "none" };
    return { kind: "finishing" };
  }

  private async _announceIdle(
    waiting: MemberSelection<"none">[],
  ): Promise<void> {
    for (const { member, waits } of waiting) {
      await this._announce(member.run, idleMessageOf(waits), { kind: "idle" });
    }
  }

  // Ends every unfinished member on one Stop, its event told only on the member it came from.
  private async _stopAll(
    members: RunList<Member>,
    stop: MemberStop,
  ): Promise<RunResult> {
    for (const member of members) {
      if (member.end !== undefined) continue;
      const event = member === stop.member ? stop.event : undefined;
      await this._stopMember({ member, message: stop.message, event });
    }
    return this._resultOf(members, stop.message);
  }

  private async _stopMember({
    member,
    message,
    event,
  }: MemberStop): Promise<void> {
    member.end = {
      result: await this._end(member.run, "stopped", message, event),
      isLanded: false,
    };
  }

  // One member's result is its own; a Batch's names which members landed and reruns the rest, its landed grouped by member in typed order.
  private _resultOf(members: RunList<Member>, cause?: string): RunResult {
    const [first, ...others] = members;
    if (others.length === 0 && first.end !== undefined) return first.end.result;
    const ends = members.flatMap(({ end }) => (end === undefined ? [] : [end]));
    const isFinished = ends.every(({ result }) => result.kind === "finished");
    const summary = batchSummaryOf(this.config.githubOwner, members);
    return {
      kind: isFinished ? "finished" : "stopped",
      landed: ends.flatMap(({ result }) => result.landed),
      message: cause === undefined ? summary : `${cause} ${summary}`,
    };
  }

  // Diffed from the run's start rather than the landing's merge, since the start is the code this process runs.
  private async _hasRunnerChangedSince(startHead: string): Promise<boolean> {
    const { primaryRoot, knobs } = this.config;
    if (knobs.runnerPaths.length === 0) return false;
    const changed = await git(
      primaryRoot,
      "diff",
      "--name-only",
      startHead,
      "HEAD",
      "--",
      ...knobs.runnerPaths,
    );
    return changed !== "";
  }

  // Logged, never announced: tmux.sh relaunches the run at once, so a Supervisor has nothing to explain.
  private _restart(members: Member[], ticket: IssueRef): RunResult {
    const message = `Restarting: the runner changed since the run started, found after landing ${issueLabelOf(ticket)}; relaunching on the landed code.`;
    members.forEach(({ run }) => {
      run.state.restart = { landed: run.landed };
      this._saveState(run);
      this._log(run, message);
    });
    const landed = members.flatMap(({ run }) => run.landed);
    return { kind: "restarting", landed, message };
  }

  // Saved at once, so a crash before the end can't make a later rerun read as a relaunch.
  private _takeRestart(run: Run): boolean {
    const { restart } = run.state;
    if (restart === undefined) return false;
    run.landed.push(...restart.landed);
    delete run.state.restart;
    this._saveState(run);
    return true;
  }

  // Sent at the first pick, so it can name the ticket about to launch, on its own member only; a first pick with no launch still shows startup passed.
  private async _announceStart(
    members: Member[],
    { reading, launch, isRelaunch }: RunStart,
  ): Promise<void> {
    const warnings = await this._stalePathWarnings();
    for (const member of members) {
      const { run } = member;
      const ticket =
        launch?.member === member ? launch.ticket.issue : undefined;
      const started = `Run started on ${run.tickets.length} tickets as ${readingLabelOf(reading.account, reading.usage)}.`;
      const summary =
        ticket === undefined
          ? started
          : `${started} Launching ${issueLabelOf(ticket)}.`;
      await this._announce(run, summary, {
        kind: "run-started",
        warnings,
        ...(ticket && { ticket }),
        ...(isRelaunch && { isRelaunch }),
      });
    }
  }

  // Warned, never refused, so stale prose can't block the ticket that would fix it.
  private async _stalePathWarnings(): Promise<string[]> {
    const { primaryRoot, knobs } = this.config;
    const found = await stalePathsOf({
      primaryRoot,
      clonePaths: knobs.clonePaths,
    });
    return found.map(stalePathLabelOf);
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
    const { waits } = await this.ticketSelector._survey(run, openHalts);
    const landed = run.tickets.filter((ticket) => isLanded(run, ticket));
    const current = waits.flatMap((wait) => currentTextOf(run, wait));
    const others = waits.filter(({ holder }) => holder?.kind !== "run");
    const lines = [
      `${issueLabelOf(specIssue)}, "${run.spec.title}"`,
      `Landed: ${joinedOrNone(landed.map(issueLabelOf))}.`,
      `Current: ${joinedOrNone(current)}.`,
      `Open Halts: ${joinedOrNone(openHalts.map(openHaltTextOf))}.`,
      `Waiting: ${others.length === 0 ? "none" : waitsTextOf(others)}.`,
      `Account: ${await this._activeReadingLabelOf(run)}.`,
    ];
    if (existsSync(this._stopRequestPathOf(specIssue))) {
      lines.push("A stop is requested; the run ends after its current ticket.");
    }
    return lines.join("\n");
  }

  private async _activeReadingLabelOf(run: Run): Promise<string> {
    try {
      const { account, usage } = await this._activeReadingOf(run);
      return readingLabelOf(account, usage);
    } catch (error) {
      if (!(error instanceof ActiveAccountUnknown)) throw error;
      return `unknown; ${noActiveAccountPhraseOf()}`;
    }
  }

  // Taken once read, so a later run never sees it; a request on any Run stops them all.
  private _takeStopRequest(runs: Run[]): boolean {
    const paths = runs
      .map((run) => this._stopRequestPathOf(run.spec.issue))
      .filter((path) => existsSync(path));
    paths.forEach((path) => rmSync(path, { force: true }));
    return paths.length > 0;
  }

  // Each unfinished member ends with its own waits; one picked to launch has none.
  private async _stopOnRequest(
    members: RunList<Member>,
    waiting: MemberSelection<"none">[],
  ): Promise<RunResult> {
    for (const member of members) {
      if (member.end !== undefined) continue;
      const { run } = member;
      const waits = waiting.find((each) => each.member === member)?.waits ?? [];
      const message = this._withRerunLine(
        run,
        stopRequestMessageOf(run, waits),
        waits,
      );
      await this._stopMember({ member, message });
    }
    return this._resultOf(members);
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

  // Runs no checks: master moves only through wrap-up, which checked the commits it landed.
  private async _preflightStop(): Promise<string | undefined> {
    const { knobs, primaryRoot } = this.config;
    if (knobs.liveCeiling <= knobs.ticketBudget) {
      return `${liveCeilingPhraseOf(knobs)} isn't above the ticket budget of ${knobs.ticketBudget}; raise the live ceiling or lower the ticket budget, and rerun`;
    }
    for (const command of knobs.authChecks) {
      if ((await runCommand(command, primaryRoot)) !== undefined) {
        return `${commandLabelOf(command)} failed: GitHub auth or the claude login is missing; sign in to whichever it checks, and rerun`;
      }
    }
    for (const [repo, clonePath] of Object.entries(knobs.clonePaths)) {
      const clone = join(primaryRoot, clonePath);
      if (!existsSync(join(clone, ".git"))) {
        return `${repo}'s primary clone is missing at ${clone}; clone ${repo} into ${clone} and rerun`;
      }
      const branch = currentBranchOf(clone);
      if (branch !== "master") {
        return `${repo}'s primary checkout is on ${branch || "a detached HEAD"}, not master; switch it to master and rerun`;
      }
    }
    return undefined;
  }

  private _stopRequestPathOf(spec: IssueRef): string {
    return join(this.config.stateFolder, `${fileStemOf(spec)}.stop`);
  }
}

// One Run's refusal is its message as written; several are told apart by a blank line.
function refusedOf(refusals: string[]): RunResult {
  return { kind: "refused", landed: [], message: refusals.join("\n\n") };
}

function runLockRefusalOf(
  spec: IssueRef,
  { holder, path }: HeldRunLock,
): string {
  const label = issueLabelOf(spec);
  if (holder === undefined) {
    return `${label}'s run lock is unreadable, so it counts as held; remove ${path} if no run of it is going.`;
  }
  return `${label} already has a run going: pid ${holder.pid}, started ${startedTextOf(holder.startedAt)}.`;
}

// The lock file is read unchecked, so a start time that isn't a date is quoted as written.
function startedTextOf(startedAt: string): string {
  const time = new Date(startedAt);
  if (Number.isNaN(time.getTime())) return startedAt;
  return localTimeOf(time);
}

function membersOf([first, ...rest]: RunList<Run>): RunList<Member> {
  return [{ run: first }, ...rest.map((run) => ({ run }))];
}

// Landed is finished with nothing waiting; the rest wait on the developer, whatever ended them.
function batchSummaryOf(owner: string, members: Member[]): string {
  const landed = members.filter(({ end }) => end?.isLanded === true);
  const [firstUnlanded, ...restUnlanded] = members
    .filter(({ end }) => end?.isLanded !== true)
    .map(({ run }) => run.spec.issue);
  const landedText = `${joinedOrNone(landed.map(({ run }) => issueLabelOf(run.spec.issue)))} landed`;
  if (firstUnlanded === undefined) return `Batch ended: ${landedText}.`;
  const unlanded = [firstUnlanded, ...restUnlanded];
  const verb = unlanded.length === 1 ? "waits" : "wait";
  const command = rerunCommandOf(owner, firstUnlanded, ...restUnlanded);
  return `Batch ended: ${landedText}; ${unlanded.map(issueLabelOf).join(", ")} ${verb} on you. Rerun the unfinished ones: \`${command}\`.`;
}

// An open Halt may be answered, and a lease released, while the run waits; anything else needs a rerun.
function isIdleWait({ reason }: Wait): boolean {
  return reason === "halted" || reason === "leased";
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
  return `Each open ${readyLabel} ticket needs a ## Model fit section naming one of the six pairs; missing or invalid in ${offenders.join(", ")}.`;
}

function openHaltTextOf(halt: Halt): string {
  return `${halt.id} on ${issueLabelOf(halt.ticket)}`;
}

function currentTextOf(run: Run, { ticket, holder }: Wait): string[] {
  if (holder?.kind !== "run") return [];
  const step = run.state.tickets[issueLabelOf(ticket)]?.step ?? "implement";
  return [`${issueLabelOf(ticket)} at ${step} (${holderLabelOf(holder)})`];
}
