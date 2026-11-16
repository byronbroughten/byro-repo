// A spec run's limit waits: the launch check before each step, which picks the account it runs on, and the wait out of a limit hit.
// The check keeps the run's account while it reads under both thresholds, else takes the lease of the top of the account ranking with the
// Active account last, each window raised to the last one a step's stream gave for it, leaving out accounts another holder has leased;
// with no account under and free, it is a Limit wait, which keeps the lease the run holds and re-ranks every poll.
// StepLauncher builds it in a lazy getter; the ranking and decisions are ../../limitGuard.ts; the lease the run holds is ../AccountHold.ts.

import { copyFileSync, existsSync } from "node:fs";
import { join } from "node:path";

import type { StepResult } from "../../AgentStep.ts";
import {
  type AccountUsage,
  type LeftOutAccount,
  type LimitWait,
  rankAccounts,
  windowNameOf,
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

interface LimitWaitingAccount {
  account: number;
  reason: LimitWait;
}

export class LimitWaiter extends SpecRunBase {
  // Runs the launch check until it gives an account, and returns that account.
  async _waitForLaunch(run: Run): Promise<number> {
    let hasAnnouncedWait = false;
    for (;;) {
      const check = await this._runLaunchCheck(run);
      if (check.kind === "launch") return check.account;
      if (!hasAnnouncedWait) {
        hasAnnouncedWait = true;
        await this._announce(run, limitWaitNoticeOf(check));
      }
      await this._sleep(this._limitPollMsOf(check.until));
    }
  }

  // The tree stays as is in the workspace; the first stream ever seen is kept for tightening limit detection.
  async _waitOutLimitHit(
    run: Run,
    { limitHit, account }: StepResult,
    logPath: string,
  ): Promise<void> {
    const savedPath = join(this.config.stateFolder, "first-limit-hit.jsonl");
    if (!existsSync(savedPath) && existsSync(logPath)) {
      copyFileSync(logPath, savedPath);
    }
    const resetsAt = limitHit?.resetsAt;
    if (resetsAt === undefined) {
      await this._warnOnce(
        run,
        "unrecognised-limit-error",
        `Unrecognised limit error on account ${account}; the saved stream can tighten detection.`,
      );
      await this._announce(
        run,
        limitWaitNoticeOf({
          account,
          reason: "hit a limit error with no reset",
          until: undefined,
        }),
      );
      await this._pollUntilLaunchable(run, undefined);
      return;
    }
    const until = new Date(
      resetsAt.getTime() + this.config.knobs.limitWaitMarginMs,
    );
    await this._announce(
      run,
      limitWaitNoticeOf({
        account,
        reason: `hit its ${hitWindowNameOf(limitHit?.window)} limit`,
        until,
      }),
    );
    await this._pollUntilLaunchable(run, until);
  }

  // The run's own account while it reads under both thresholds, else the top-ranked one whose lease it can take, which the run then keeps.
  private async _runLaunchCheck(run: Run): Promise<LaunchCheck> {
    const hold = run.accountHold;
    const usageList = await this._knownActiveUsageListOf(run);
    const { ranked, leftOut } = rankAccounts({
      usageList,
      leasedAccounts: hold.otherHoldersAccounts(),
      unavailableAccounts: new Set(),
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
      return launchWaitOf(hold.account, [...leftOut, ...takenFirst]);
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

  // Sleeps before each check, so a limit hit waits at least one poll; past `until` a stale reading keeps this wait going rather than announcing a second one.
  private async _pollUntilLaunchable(
    run: Run,
    until: Date | undefined,
  ): Promise<void> {
    for (;;) {
      await this._sleep(this._limitPollMsOf(until));
      const check = await this._runLaunchCheck(run);
      if (check.kind === "launch") return;
    }
  }
}

function leasedOf(account: number): LeftOutAccount {
  return { account, reason: { kind: "leased" } };
}

// Names the run's own account when a threshold holds it, else the one that resets first; with none past a threshold, why none is free.
function launchWaitOf(
  heldAccount: number | undefined,
  leftOut: LeftOutAccount[],
): LaunchWait {
  const waiting = leftOut.flatMap(({ account, reason }) =>
    reason.kind === "limitWait" ? [{ account, reason }] : [],
  );
  const earliest = earliestOf(waiting);
  const named =
    waiting.find(({ account }) => account === heldAccount) ?? earliest;
  if (named === undefined) {
    return {
      kind: "limitWait",
      account: undefined,
      reason: unthresholdedWaitOf(leftOut),
      until: undefined,
    };
  }
  const { window, utilization } = named.reason;
  return {
    kind: "limitWait",
    account: named.account,
    reason: `is at ${percentOf(utilization)} of its ${windowNameOf(window)} limit`,
    until: earliest?.reason.until,
  };
}

function unthresholdedWaitOf(leftOut: LeftOutAccount[]): string {
  const isAnyLeased = leftOut.some(({ reason }) => reason.kind === "leased");
  if (isAnyLeased) return "every account is leased by another run";
  return "no account is enabled in cswap";
}

function earliestOf(
  waiting: LimitWaitingAccount[],
): LimitWaitingAccount | undefined {
  let earliest: LimitWaitingAccount | undefined;
  for (const each of waiting) {
    if (
      earliest === undefined ||
      each.reason.until.getTime() < earliest.reason.until.getTime()
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
  return windowNameOf(window);
}
