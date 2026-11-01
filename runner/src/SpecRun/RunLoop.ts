// The run loop works a list of members, one Run each, and holds each one's RunLock while it runs; several are a Batch.
// Its PreflightChecker refuses or Stops the run first. Then it picks tickets one at a time across members and runs each, a member held by a Halt stepping aside,
// as does one blocked by a member not yet landed, which ends once that member ends unlanded;
// idling while open Halts and other holders' leases are all that's in the way, until every member is done or something Stops it.
// Any outcome a later ticket will handle (red checks, step errors, schema failures) is an UnhandledStop; a red master Stops the run.
// A stop request (StatusReporter.ts) ends the run between tickets, and a `stop spec` answer its own member.
// A landing that changes the runner's own source ends it restarting, for tmux.sh to relaunch.
// ../SpecRun.ts builds one per run, with its member list, and delegates run to it.
// It builds its own PreflightChecker, TicketSelector, TicketSequencer and ReviewListPoster.

import { existsSync, rmSync } from "node:fs";

import { git } from "../git.ts";
import { type Halt } from "../halts.ts";
import { issueLabelOf, type IssueRef } from "../IssueWorkspaces.ts";
import { type AccountReading, readingLabelOf } from "../limitGuard.ts";
import { RunStop } from "../RunStop.ts";
import { stalePathLabelOf, stalePathsOf } from "../stalePaths.ts";
import {
  type Member,
  memberIssueOf,
  type MemberSelection,
  MemberSelections,
} from "./MemberSelections.ts";
import { PreflightChecker } from "./PreflightChecker.ts";
import { ReviewListPoster } from "./ReviewListPoster.ts";
import {
  type BatchView,
  blockedByTextOf,
  idListOf,
  isAmong,
  joinedOrNone,
  landedTextOf,
  memberBlockedWaitOf,
  type MemberList,
  rerunCommandOf,
  type Run,
  type RunResult,
  type TicketOutcome,
  unlandedBlockersOf,
  type Wait,
  waitsTextOf,
  waitsToLandTextOf,
} from "./runState.ts";
import {
  type RunEvent,
  SpecRunBase,
  type SpecRunConfig,
} from "./SpecRunBase.ts";
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

// A Stop's message, and the event on the member it came from.
interface MemberStop {
  member: Member;
  message: string;
  event?: RunEvent;
}

// Each member waiting on other members to land, to those members.
type MemberBlockers = Map<Member, Member[]>;

interface Picking {
  blockersOf: MemberBlockers;
  landedMembers: IssueRef[];
}

// A member and the members it waits on, for its end message.
interface BlockedMember {
  owner: string;
  member: Member;
  blockers: Member[];
}

type Finishing =
  | { kind: "none" }
  | { kind: "finishing" }
  | { kind: "stopped"; stop: MemberStop };

export class RunLoop extends SpecRunBase {
  private readonly memberIssues: MemberList;

  constructor(config: SpecRunConfig, memberIssues: MemberList) {
    super(config);
    this.memberIssues = memberIssues;
  }

  private get preflightChecker(): PreflightChecker {
    return new PreflightChecker(this.config, this.memberIssues);
  }

  private get ticketSelector(): TicketSelector {
    return new TicketSelector(this.config);
  }

  private get ticketSequencer(): TicketSequencer {
    return new TicketSequencer(this.config);
  }

  private get reviewListPoster(): ReviewListPoster {
    return new ReviewListPoster(this.config);
  }

  async run(): Promise<RunResult> {
    const { preflightChecker, memberIssues } = this;
    const { locks, liveRunRefusals } = preflightChecker._takeRunLocks();
    if (liveRunRefusals.size > 0) {
      try {
        return await preflightChecker._refuseBesideLiveRuns(liveRunRefusals);
      } finally {
        locks.forEach((lock) => lock.release());
      }
    }
    let isRestarting = false;
    try {
      // Opened once every lock is held, so the record never names a member another run holds.
      await this.batchRecords.open(memberIssues, process.pid);
      const result = await this._runHoldingLocks();
      isRestarting = result.kind === "restarting";
      return result;
    } finally {
      // Closed on a throw too, so status and supervise never find a dead Batch.
      if (!isRestarting) this.batchRecords.close(memberIssues);
      locks.forEach((lock) => lock.release());
    }
  }

  private async _runHoldingLocks(): Promise<RunResult> {
    const startedAt = this.config.clock.now();
    const runs = await this._startRuns();
    const result = await this._runMembers(runs, startedAt);
    await this._announceBatchEnd(runs, result);
    return result;
  }

  // A member ends on its own, by finishing or a `stop spec`, while the others carry on; a Stop ends every unfinished one.
  private async _runMembers(
    runs: RunList<Run>,
    startedAt: Date,
  ): Promise<RunResult> {
    // Each Run's restart is taken, whichever relaunches, so no later rerun reads one again.
    let isRelaunch = false;
    runs.forEach((run) => {
      if (this._takeRestart(run)) isRelaunch = true;
    });
    const refused = await this.preflightChecker._refusalOf(runs);
    if (refused !== undefined) return refused;
    const members = membersOf(runs);
    // The account and the primary checkout concern every member alike; the first member reads them.
    const [lead] = members;
    const preflightStop = await this.preflightChecker._preflightStop();
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
      const blockersOf = await this._memberBlockersOf(unfinished, members);
      if (await this._endUnlandableWaits(blockersOf, unfinished)) continue;
      const selections = await this._selectEach(unfinished, {
        blockersOf,
        landedMembers: landedIssuesOf(members),
      });
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

  // Sent while the Batch record is open, so the line reaches the Batch's file; a Restart's relaunch carries the run on, so it ends nothing.
  private async _announceBatchEnd(
    [lead, ...others]: RunList<Run>,
    { kind, message }: RunResult,
  ): Promise<void> {
    if (others.length === 0 || kind === "restarting") return;
    await this._announce(lead, message, { kind, isBatchEnd: true });
  }

  private _startRuns(): Promise<RunList<Run>> {
    const [first, ...rest] = this.memberIssues;
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

  // Each unfinished member's blockers among the members that haven't landed; a landed one counts as cleared though GitHub may show it open.
  private async _memberBlockersOf(
    unfinished: Member[],
    members: RunList<Member>,
  ): Promise<MemberBlockers> {
    const blockersOf: MemberBlockers = new Map();
    if (members.length === 1) return blockersOf;
    const batch: BatchView = {
      memberIssues: this.memberIssues,
      landedMembers: landedIssuesOf(members),
    };
    for (const member of unfinished) {
      const open = await this.config.github.openBlockersOf(
        memberIssueOf(member),
      );
      const blockerIssues = unlandedBlockersOf(open, batch);
      const blockers = members.filter((each) =>
        isAmong(memberIssueOf(each), blockerIssues),
      );
      if (blockers.length > 0) blockersOf.set(member, blockers);
    }
    return blockersOf;
  }

  // A member whose blocker member ended without landing is done too, as is each member of a blocking cycle once only the cycle is left; true when one ended.
  private async _endUnlandableWaits(
    blockersOf: MemberBlockers,
    unfinished: Member[],
  ): Promise<boolean> {
    const owner = this.config.githubOwner;
    // Every unfinished member waiting on an unfinished one is a cycle no landing breaks.
    const isCycle = blockersOf.size === unfinished.length;
    let isEnded = false;
    for (const [member, blockers] of blockersOf) {
      const ended = blockers.filter(({ end }) => end !== undefined);
      if (ended.length === 0 && !isCycle) continue;
      let message: string;
      if (ended.length === 0) {
        message = cycleMessageOf({ owner, member, blockers });
      } else {
        message = unlandedBlockerMessageOf({ owner, member, blockers: ended });
      }
      await this._stopMember({ member, message });
      isEnded = true;
    }
    return isEnded;
  }

  // Every member not waiting on another is read, since a `stop spec` answer is returned only by the pick that reads it, and answers are ordered across members.
  private async _selectEach(
    members: Member[],
    { blockersOf, landedMembers }: Picking,
  ): Promise<MemberSelections> {
    const selections: MemberSelection[] = [];
    for (const member of members) {
      const blockers = blockersOf.get(member);
      if (blockers !== undefined) {
        const waits = [
          memberBlockedWaitOf(
            memberIssueOf(member),
            blockers.map(memberIssueOf),
          ),
        ];
        selections.push({ member, kind: "none", waits });
        continue;
      }
      const selection = await this.ticketSelector._select(
        member.run,
        landedMembers,
      );
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

function landedIssuesOf(members: Member[]): IssueRef[] {
  return members.flatMap((member) =>
    member.end?.isLanded === true ? [memberIssueOf(member)] : [],
  );
}

function memberLabelsOf(members: Member[]): string[] {
  return members.map((member) => issueLabelOf(memberIssueOf(member)));
}

// Rerun with its blockers, since alone it would find them open and wait on you.
function unlandedBlockerMessageOf(blocked: BlockedMember): string {
  const { member, blockers } = blocked;
  const label = issueLabelOf(memberIssueOf(member));
  const which = blockers.length === 1 ? "it can" : "they can";
  const blockedBy = blockedByTextOf(label, memberLabelsOf(blockers));
  return `${blockedBy}, which ended without landing; rerun them together once ${which} land: \`${blockedRerunCommandOf(blocked)}\`.`;
}

function cycleMessageOf(blocked: BlockedMember): string {
  const { member, blockers } = blocked;
  const label = issueLabelOf(memberIssueOf(member));
  const verb = blockers.length === 1 ? "waits" : "wait";
  const waitsToLand = waitsToLandTextOf(label, memberLabelsOf(blockers));
  return `${waitsToLand}, which ${verb} on it in turn; remove one blocked-by link on GitHub, then rerun: \`${blockedRerunCommandOf(blocked)}\`.`;
}

function blockedRerunCommandOf({
  owner,
  member,
  blockers,
}: BlockedMember): string {
  const blockerIssues = blockers.map(memberIssueOf);
  return rerunCommandOf(owner, memberIssueOf(member), ...blockerIssues);
}

// An open Halt may be answered, a lease released and a blocker member landed while the run waits; anything else needs a rerun.
function isIdleWait({ reason }: Wait): boolean {
  return (
    reason === "halted" || reason === "leased" || reason === "member-blocked"
  );
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
