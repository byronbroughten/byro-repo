// The run loop: preflight refuses or Stops a run first, then it picks tickets one at a time and runs each, idling
// while an open Halt or another holder's lease is all that's in the way, until every ticket lands or something Stops it.
// Any outcome a later ticket will handle (red checks, step errors, schema failures) is an UnhandledStop; a red master Stops the run.
// requestStop() or a `stop spec` answer ends the run between tickets; status() reads it from outside.
// ../SpecRun.ts delegates run, status and requestStop to it.
// It builds its own TicketSelector, TicketSequencer and ReviewListPoster.

import { existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { commandLabelOf } from "../failureText.ts";
import { currentBranchOf } from "../git.ts";
import { type Halt } from "../halts.ts";
import {
  fileStemOf,
  holderLabelOf,
  issueLabelOf,
  type IssueRef,
} from "../IssueWorkspaces.ts";
import { type AccountReading } from "../limitGuard.ts";
import { pairOf } from "../modelFit.ts";
import { RunStop } from "../RunStop.ts";
import { percentOf } from "../transcriptFacts.ts";
import { ReviewListPoster } from "./ReviewListPoster.ts";
import {
  idListOf,
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
  ticketStateOf,
  type TrackedIssue,
  type Wait,
  waitsTextOf,
} from "./runState.ts";
import { SpecRunBase } from "./SpecRunBase.ts";
import { TicketSelector } from "./TicketSelector.ts";
import { TicketSequencer } from "./TicketSequencer.ts";

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
      const selection = await this.ticketSelector._select(run);
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
        outcome = await this.ticketSequencer._runTicket(run, selection.ticket);
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

  private _stopRequestPathOf(spec: IssueRef): string {
    return join(this.config.stateFolder, `${fileStemOf(spec)}.stop`);
  }
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

function stoppedMessageOf(run: Run, ticket: TrackedIssue): string {
  const { stop } = ticketStateOf(run, ticket.issue);
  return `Stopped on ${issueLabelOf(ticket.issue)}: ${stop ?? "an unhandled outcome"}.`;
}

function readingLabelOf({ account, usage }: AccountReading): string {
  if (usage === undefined) return `account ${account}: no usage reading`;
  return `account ${account}: 5-hour ${percentOf(usage.fiveHour.utilization)}, weekly ${percentOf(usage.sevenDay.utilization)}`;
}
