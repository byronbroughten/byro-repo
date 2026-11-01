// The run's preflight, which refuses or Stops a run before its first pick: it takes each member's RunLock,
// collects every member's refusal (a live run, the spec's authorship, Model fit, targets and, in a Batch, the Standalone checks),
// and runs the shared preflight Stop once. It holds the member list, so a list of one skips the Standalone checks.
// RunLoop.ts calls _takeRunLocks, then _refuseBesideLiveRuns or _refusalOf and _preflightStop.

import { existsSync } from "node:fs";
import { join } from "node:path";

import { commandLabelOf } from "../failureText.ts";
import { currentBranchOf } from "../git.ts";
import { issueLabelOf, type IssueRef } from "../IssueWorkspaces.ts";
import { localTimeOf } from "../localTime.ts";
import { pairOf } from "../modelFit.ts";
import { type HeldRunLock, RunLock } from "../RunLock.ts";
import {
  interactiveLabel,
  isLaunchable,
  issuesOutside,
  type MemberList,
  readyLabel,
  type Run,
  runCommand,
  type RunResult,
  targetsRefusalOf,
  type TrackedIssue,
} from "./runState.ts";
import { ticketSteps } from "./runState/ticketSteps.ts";
import { SpecRunBase, type SpecRunConfig } from "./SpecRunBase.ts";

interface LocksTaken {
  locks: RunLock[];
  liveRunRefusals: Map<IssueRef, string>;
}

interface MemberRefusal {
  member: IssueRef;
  refusal: string;
}

export class PreflightChecker extends SpecRunBase {
  private readonly memberIssues: MemberList;
  private readonly isBatch: boolean;

  constructor(config: SpecRunConfig, memberIssues: MemberList) {
    super(config);
    this.memberIssues = memberIssues;
    this.isBatch = memberIssues.length > 1;
  }

  // The per-Run preflight's first check.
  _takeRunLocks(): LocksTaken {
    const locks: RunLock[] = [];
    const liveRunRefusals = new Map<IssueRef, string>();
    this.memberIssues.forEach((memberIssue) => {
      const taken = RunLock.take(this.config.stateFolder, memberIssue);
      if (taken.kind === "held") {
        liveRunRefusals.set(memberIssue, runLockRefusalOf(memberIssue, taken));
      } else {
        locks.push(taken.lock);
      }
    });
    return { locks, liveRunRefusals };
  }

  // Announced, the refusal would land in a live run's event file as its run-ended line; no stop request is cleared, so a live run's survives.
  async _refuseBesideLiveRuns(
    liveRunRefusals: Map<IssueRef, string>,
  ): Promise<RunResult> {
    const refusals: MemberRefusal[] = [];
    for (const memberIssue of this.memberIssues) {
      const liveRunRefusal = liveRunRefusals.get(memberIssue);
      if (liveRunRefusal !== undefined) {
        refusals.push({ member: memberIssue, refusal: liveRunRefusal });
        continue;
      }
      const run = await this._startRun(memberIssue);
      const refusal = await this._memberRefusalOf(run);
      if (refusal !== undefined) refusals.push(refusal);
    }
    return this._refusedOf(refusals);
  }

  // The per-Run preflight's spec checks, each Run's refusal announced on its own Run; undefined when none refused.
  async _refusalOf(runs: Run[]): Promise<RunResult | undefined> {
    const refusals: MemberRefusal[] = [];
    for (const run of runs) {
      const refusal = await this._memberRefusalOf(run);
      if (refusal === undefined) continue;
      await this._announce(run, `Refused: ${refusal.refusal}`, {
        kind: "refused",
      });
      refusals.push(refusal);
    }
    if (refusals.length === 0) return undefined;
    return this._refusedOf(refusals);
  }

  // Runs no checks: master moves only through wrap-up, which checked the commits it landed.
  async _preflightStop(): Promise<string | undefined> {
    const { knobs, primaryRoot } = this.config;
    if (knobs.liveCeiling <= knobs.ticketBudget) {
      return `${ticketSteps.liveCeilingPhraseOf(knobs)} isn't above the ticket budget of ${knobs.ticketBudget}; raise the live ceiling or lower the ticket budget, and rerun`;
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

  private async _memberRefusalOf(run: Run): Promise<MemberRefusal | undefined> {
    const refusal = await this._runRefusalOf(run);
    if (refusal === undefined) return undefined;
    return { member: run.spec.issue, refusal };
  }

  // A list of one skips the Standalone checks, as before Batches.
  private async _runRefusalOf(run: Run): Promise<string | undefined> {
    const launchable = await this._launchableTicketsOf(run);
    // A ticket's body is left to the launch-time check, whose Halt can approve it.
    const refusal =
      (await this._authorshipRefusal("the spec", [run.spec])) ??
      modelFitRefusalOf(run, launchable) ??
      targetsRefusalOf(run, launchable);
    if (refusal !== undefined) return refusal;
    if (!this.isBatch || !run.isStandalone) return undefined;
    return this._standaloneRefusalOf(run.spec, isLandedByThisRun(run));
  }

  // A Standalone ticket has none; the preflight refusals check the spec itself.
  private async _launchableTicketsOf(run: Run): Promise<TrackedIssue[]> {
    if (run.isStandalone) return [];
    const launchable: TrackedIssue[] = [];
    for (const ticket of run.tickets) {
      const tracked = await this.config.github.issueOf(ticket);
      if (isLaunchable(tracked)) launchable.push(tracked);
    }
    return launchable;
  }

  private async _standaloneRefusalOf(
    ticket: TrackedIssue,
    isLanded: boolean,
  ): Promise<string | undefined> {
    const { github } = this.config;
    // A member this run landed before its Restart closed by landing; the relaunch resumes it.
    if (!ticket.isOpen && !isLanded) return `it's closed; ${dropPhraseOf()}.`;
    const isReady = [readyLabel, interactiveLabel].some((label) =>
      ticket.labels.includes(label),
    );
    if (!isReady) {
      return `it has neither ${readyLabel} nor ${interactiveLabel}; label it, or ${dropPhraseOf()}.`;
    }
    const parent = await github.parentOf(ticket.issue);
    if (parent !== undefined) {
      return `it belongs to the spec ${issueLabelOf(parent.issue)}; run it through its spec.`;
    }
    // A member blocker is waited on in the run; a landed but unjudged issue outside the Batch still refuses.
    const blockers = issuesOutside(
      await github.openBlockersOf(ticket.issue),
      this.memberIssues,
    );
    if (blockers.length === 0) return undefined;
    const pronoun = blockers.length === 1 ? "that" : "those";
    return `it's blocked by ${blockers.map(issueLabelOf).join(", ")}, still open; land ${pronoun} first, or ${dropPhraseOf()}.`;
  }

  // A list of one's refusal is its message as written; a Batch's names each member, told apart by a blank line.
  private _refusedOf(refusals: MemberRefusal[]): RunResult {
    const reasons = refusals.map(({ member, refusal }) => {
      if (!this.isBatch) return refusal;
      return `${issueLabelOf(member)}: ${refusal}`;
    });
    return { kind: "refused", landed: [], message: reasons.join("\n\n") };
  }
}

// Filled before preflight only from a taken Restart, so a fresh launch's is empty.
function isLandedByThisRun(run: Run): boolean {
  const label = issueLabelOf(run.spec.issue);
  return run.landed.some((landed) => issueLabelOf(landed) === label);
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
  if (run.isStandalone) {
    if (pairOf(run.spec.body) !== undefined) return undefined;
    return `${issueLabelOf(run.spec.issue)} has no sub-issues and no valid ## Model fit section: split it with /code-tickets, or add the section.`;
  }
  const offenders = launchable.flatMap(({ issue, body }) =>
    pairOf(body) === undefined ? [issueLabelOf(issue)] : [],
  );
  if (offenders.length === 0) return undefined;
  return `Each open ${readyLabel} ticket needs a ## Model fit section naming one of the six pairs; missing or invalid in ${offenders.join(", ")}.`;
}

// A Standalone refusal's way out, said alike by each.
function dropPhraseOf(): string {
  return "drop it from the list";
}
