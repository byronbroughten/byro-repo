// A spec run's limit waits: the launch check before each step, which picks the account it runs on, and the move off a limit hit.
// The check keeps the run's account while it reads under both thresholds, else takes the lease of the top of the account ranking with the
// Active account last, each window raised to the last one a step's stream gave for it, leaving out accounts another holder has leased
// and those a limit hit made unavailable to the run; with no account under and free, it is a Limit wait, which keeps the lease the run holds
// and re-ranks every poll. A limit hit marks its account unavailable and runs the check at once, so the step resumes on another free account.
// StepLauncher builds it in a lazy getter; the ranking and decisions are ../../limitGuard.ts; the lease the run holds and its unavailable
// accounts, both shared across a Batch's members, are ../AccountHold.ts.

import { copyFileSync, existsSync } from "node:fs";
import { join } from "node:path";

import { accountLine } from "../../accountLine.ts";
import type { StepResult } from "../../AgentStep.ts";
import {
  type AccountUsage,
  decideReading,
  freshReadingOf,
  type LeftOutAccount,
  rankAccounts,
  type UsageList,
} from "../../limitGuard.ts";
import { localTimeOf } from "../../localTime.ts";
import { limitWaitLineOf } from "../../progressLines.ts";
import { percentOf } from "../../transcriptFacts.ts";
import type { Run, RunWarning } from "../runState.ts";
import { SpecRunBase } from "../SpecRunBase.ts";

// A wait names one account; `until` is the earliest reset among the accounts that would continue the run, undefined with none.
interface LaunchWait {
  kind: "limitWait";
  account: number | undefined;
  reason: string;
  until: Date | undefined;
}

type LaunchCheck = { kind: "launch"; account: number } | LaunchWait;

// A launch no account could take. `unavailableUntils` are the known ends of the run's unavailable accounts no other run leases,
// which may continue the run before any threshold lifts.
interface BlockedLaunch {
  heldAccount: number | undefined;
  leftOut: LeftOutAccount[];
  unavailableUntils: Date[];
}

export class LimitWaiter extends SpecRunBase {
  // Runs the launch check until it gives an account, and returns that account.
  async _waitForLaunch(run: Run): Promise<number> {
    return this._pollForLaunch(run, limitWaitNoticeOf);
  }

  // The tree stays as is in the workspace; the first stream ever seen is kept for tightening limit detection.
  // The launch check runs at once, so a free account resumes the step with no wait; the check takes its lease before releasing the hit one's.
  async _moveOffLimitHit(
    run: Run,
    { limitHit, account }: StepResult,
    logPath: string,
  ): Promise<void> {
    const savedPath = join(this.config.stateFolder, "first-limit-hit.jsonl");
    if (!existsSync(savedPath) && existsSync(logPath)) {
      copyFileSync(logPath, savedPath);
    }
    const resetsAt = limitHit?.resetsAt;
    let reason = `hit its ${hitWindowNameOf(limitHit?.window)} limit`;
    let unavailableUntil: Date | undefined;
    if (resetsAt === undefined) {
      reason = "hit a limit error with no reset";
      await this._warnOnce(
        run,
        "unrecognised-limit-error",
        `Unrecognised limit error on account ${account}; the saved stream can tighten detection.`,
      );
    } else {
      unavailableUntil = new Date(
        resetsAt.getTime() + this.config.knobs.limitWaitMarginMs,
      );
    }
    run.accountHold.unavailableAccounts.set(account, unavailableUntil);
    await this._pollForLaunch(run, ({ until }) =>
      limitWaitNoticeOf({ account, reason, until }),
    );
  }

  // Announces the first wait only, in the words `noticeOf` gives it.
  private async _pollForLaunch(
    run: Run,
    noticeOf: (wait: LaunchWait) => string,
  ): Promise<number> {
    let hasAnnouncedWait = false;
    for (;;) {
      const check = await this._runLaunchCheck(run);
      if (check.kind === "launch") return check.account;
      if (!hasAnnouncedWait) {
        hasAnnouncedWait = true;
        await this._announce(run, noticeOf(check));
      }
      await this._sleep(this._limitPollMsOf(check.until));
    }
  }

  // The run's own account while it reads under both thresholds, else the top-ranked one whose lease it can take, which the run then keeps.
  private async _runLaunchCheck(run: Run): Promise<LaunchCheck> {
    const hold = run.accountHold;
    const usageList = await this._knownActiveUsageListOf(run);
    this._clearLapsedUnavailable(run, usageList);
    const leasedAccounts = hold.otherHoldersAccounts();
    const { ranked, leftOut } = rankAccounts({
      usageList,
      leasedAccounts,
      unavailableAccounts: new Set(run.accountHold.unavailableAccounts.keys()),
      streamUsage: run.streamUsage,
      knobs: this.config.knobs,
      putActiveLast: true,
    });
    const held = ranked.find(
      ({ account, usage }) => account === hold.account && usage !== undefined,
    );
    let candidates = ranked;
    if (held !== undefined) {
      candidates = [held, ...ranked.filter((each) => each !== held)];
    }
    const leasedAccount = hold.leaseFirstOf(
      candidates.map(({ account }) => account),
    );
    const picked = ranked.find(({ account }) => account === leasedAccount);
    if (picked === undefined) {
      // Any ranked account left here was taken by another holder between the read and the take.
      const takenFirst = ranked.map(({ account }) => leasedOf(account));
      return launchWaitOf({
        heldAccount: hold.account,
        leftOut: [...leftOut, ...takenFirst],
        unavailableUntils: [...run.accountHold.unavailableAccounts].flatMap(
          ([account, until]) => {
            if (until === undefined || leasedAccounts.has(account)) return [];
            return [until];
          },
        ),
      });
    }
    if (picked.usage === undefined) {
      await this._warnOnce(
        run,
        "missing-reading",
        `No usage reading for account ${picked.account}; steps launch unguarded.`,
      );
    }
    return { kind: "launch", account: picked.account };
  }

  // A hit with a reset lapses at its time, even while cswap's stale reading reads under; one with none, once the account reads under its thresholds.
  // Without a usable reading an account can't be shown under, so it stays unavailable.
  private _clearLapsedUnavailable(run: Run, { readings }: UsageList): void {
    const now = this.config.clock.now().getTime();
    for (const [account, until] of run.accountHold.unavailableAccounts) {
      let isLapsed = false;
      if (until === undefined) {
        const reading = readings.find((each) => each.account === account);
        if (reading !== undefined) {
          const fresh = freshReadingOf(reading, run.streamUsage);
          isLapsed = decideReading(fresh, this.config.knobs)?.kind === "launch";
        }
      } else {
        isLapsed = until.getTime() <= now;
      }
      if (isLapsed) run.accountHold.unavailableAccounts.delete(account);
    }
  }

  // Polls every idlePollMs, so an account coming under its thresholds ends the wait within one poll.
  private _limitPollMsOf(until: Date | undefined): number {
    const { idlePollMs } = this.config.knobs;
    if (until === undefined) return idlePollMs;
    const remainingMs = until.getTime() - this.config.clock.now().getTime();
    if (remainingMs <= 0) return idlePollMs;
    return Math.min(idlePollMs, remainingMs);
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
}

function leasedOf(account: number): LeftOutAccount {
  return { account, reason: { kind: "leased" } };
}

// Names the run's own account when a threshold holds it, else the one that resets first; with none past a threshold, why none is free.
function launchWaitOf({
  heldAccount,
  leftOut,
  unavailableUntils,
}: BlockedLaunch): LaunchWait {
  const waiting = leftOut.flatMap(({ account, reason }) =>
    reason.kind === "limitWait" ? [{ account, reason }] : [],
  );
  const until = earliestOf(
    [...waiting.map(({ reason }) => reason.until), ...unavailableUntils],
    (date) => date,
  );
  const named =
    waiting.find(({ account }) => account === heldAccount) ??
    earliestOf(waiting, ({ reason }) => reason.until);
  if (named === undefined) {
    return {
      kind: "limitWait",
      account: undefined,
      reason: unthresholdedWaitOf(leftOut),
      until,
    };
  }
  const { window, utilization } = named.reason;
  return {
    kind: "limitWait",
    account: named.account,
    reason: `is at ${percentOf(utilization)} of its ${accountLine.windowNameOf(window)} limit`,
    until,
  };
}

function unthresholdedWaitOf(leftOut: LeftOutAccount[]): string {
  const kinds = new Set(leftOut.map(({ reason }) => reason.kind));
  if (kinds.has("unavailable")) {
    return "each account hit a limit in this run, is leased by another run or is disabled in cswap";
  }
  if (kinds.has("leased")) return "every account is leased by another run";
  return "no account is enabled in cswap";
}

function earliestOf<IT>(
  items: IT[],
  dateOf: (item: IT) => Date,
): IT | undefined {
  let earliest: IT | undefined;
  for (const each of items) {
    if (
      earliest === undefined ||
      dateOf(each).getTime() < dateOf(earliest).getTime()
    ) {
      earliest = each;
    }
  }
  return earliest;
}

function limitWaitNoticeOf({
  account,
  reason,
  until,
}: Omit<LaunchWait, "kind">): string {
  let continuing = "once an account reads under its thresholds";
  if (until !== undefined) continuing = `after ${localTimeOf(until)}`;
  let subject = reason;
  if (account !== undefined) subject = `account ${account} ${reason}`;
  return limitWaitLineOf(
    `${subject}; continuing ${continuing}. An account another run releases continues the run too.`,
  );
}

function hitWindowNameOf(window: keyof AccountUsage | undefined): string {
  if (window === undefined) return "usage";
  return accountLine.windowNameOf(window);
}
