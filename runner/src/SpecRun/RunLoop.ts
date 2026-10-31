// The run loop: it holds the spec's RunLock while it runs, and preflight refuses or Stops a run first.
// Then it picks tickets one at a time and runs each, idling while an open Halt or another holder's lease
// is all that's in the way, until every ticket lands or something Stops it.
// Any outcome a later ticket will handle (red checks, step errors, schema failures) is an UnhandledStop; a red master Stops the run.
// requestStop() or a `stop spec` answer ends the run between tickets; status() reads it from outside.
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
import { ReviewListPoster } from "./ReviewListPoster.ts";
import {
  idListOf,
  isLanded,
  isLaunchable,
  landedTextOf,
  liveCeilingPhraseOf,
  openHaltsOf,
  readyLabel,
  type Run,
  runCommand,
  type RunResult,
  targetsRefusalOf,
  type TicketOutcome,
  type TrackedIssue,
  type Wait,
  waitsTextOf,
} from "./runState.ts";
import { SpecRunBase } from "./SpecRunBase.ts";
import { type Selection, TicketSelector } from "./TicketSelector.ts";
import { TicketSequencer } from "./TicketSequencer.ts";

interface RunStart {
  reading: AccountReading;
  selection: Selection;
  isRelaunch: boolean;
}

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

  async run(specIssue: IssueRef): Promise<RunResult> {
    const taken = RunLock.take(this.config.stateFolder, specIssue);
    // Announced, the refusal would land in the live run's event file as its run-ended line.
    if (taken.kind === "held") {
      return {
        kind: "refused",
        landed: [],
        message: runLockRefusalOf(specIssue, taken),
      };
    }
    try {
      return await this._runHoldingLock(specIssue);
    } finally {
      taken.lock.release();
    }
  }

  private async _runHoldingLock(specIssue: IssueRef): Promise<RunResult> {
    const startedAt = this.config.clock.now();
    // A request left by a stop command with no run going would end this run at its first pick.
    rmSync(this._stopRequestPathOf(specIssue), { force: true });
    const run = await this._startRun(specIssue);
    const isRelaunch = this._takeRestart(run);
    const launchable = await this._launchableTicketsOf(run);
    // A ticket's body is left to the launch-time check, whose Halt can approve it.
    const refusal =
      (await this._authorshipRefusal("the spec", [run.spec])) ??
      modelFitRefusalOf(run, launchable) ??
      targetsRefusalOf(run, launchable);
    if (refusal !== undefined) {
      await this._announce(run, `Refused: ${refusal}`, { kind: "refused" });
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
    let reading: AccountReading;
    try {
      reading = await this._activeReadingOf(run);
    } catch (error) {
      if (!(error instanceof RunStop)) throw error;
      return this._end(run, "stopped", error.message);
    }
    const startHead = await git(this.config.primaryRoot, "rev-parse", "HEAD");
    let isStartAnnounced = false;
    let isIdle = false;
    for (;;) {
      const selection = await this.ticketSelector._select(run);
      if (!isStartAnnounced) {
        await this._announceStart(run, { reading, selection, isRelaunch });
        isStartAnnounced = true;
      }
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
        if (!isIdle) {
          await this._announce(run, idleMessageOf(waits), { kind: "idle" });
        }
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
          { ticket: selection.ticket.issue },
        );
      }
      let outcome: TicketOutcome;
      try {
        outcome = await this.ticketSequencer._runTicket(run, selection.ticket);
      } catch (error) {
        if (!(error instanceof RunStop)) throw error;
        return this._end(run, "stopped", error.message, error.event);
      }
      if (outcome === "leased" || outcome === "halted") continue;
      run.landed.push(selection.ticket.issue);
      run.failureStreak = [];
      if (await this._hasRunnerChangedSince(startHead)) {
        return this._restart(run, selection.ticket.issue);
      }
    }
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
  private _restart(run: Run, ticket: IssueRef): RunResult {
    const message = `Restarting: the runner changed since the run started, found after landing ${issueLabelOf(ticket)}; relaunching on the landed code.`;
    run.state.restart = { landed: run.landed };
    this._saveState(run);
    this._log(run, message);
    return { kind: "restarting", landed: run.landed, message };
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

  // Sent at the first pick, so it can name the ticket about to launch; a first pick with no launch still shows startup passed.
  private async _announceStart(
    run: Run,
    { reading, selection, isRelaunch }: RunStart,
  ): Promise<void> {
    const started = `Run started on ${run.tickets.length} tickets as ${readingLabelOf(reading.account, reading.usage)}.`;
    const ticket =
      selection.kind === "launch" ? selection.ticket.issue : undefined;
    const summary =
      ticket === undefined
        ? started
        : `${started} Launching ${issueLabelOf(ticket)}.`;
    await this._announce(run, summary, {
      kind: "run-started",
      warnings: await this._stalePathWarnings(),
      ...(ticket && { ticket }),
      ...(isRelaunch && { isRelaunch }),
    });
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

function openHaltTextOf(halt: Halt): string {
  return `${halt.id} on ${issueLabelOf(halt.ticket)}`;
}

function currentTextOf(run: Run, { ticket, holder }: Wait): string[] {
  if (holder?.kind !== "run") return [];
  const step = run.state.tickets[issueLabelOf(ticket)]?.step ?? "implement";
  return [`${issueLabelOf(ticket)} at ${step} (${holderLabelOf(holder)})`];
}
