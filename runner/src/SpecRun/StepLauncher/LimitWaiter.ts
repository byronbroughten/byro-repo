// A spec run's limit waits: holds a step's launch until the Active account reads under its thresholds, and waits out a limit hit.
// The Active account's reading is judged with each window raised to the last one a step's stream gave for it.
// StepLauncher builds it in a lazy getter; the decisions are ../../limitGuard.ts.

import { copyFileSync, existsSync } from "node:fs";
import { join } from "node:path";

import type { StepResult } from "../../AgentStep.ts";
import {
  type AccountUsage,
  decideStep,
  freshestUsageOf,
  type GuardDecision,
  windowNameOf,
} from "../../limitGuard.ts";
import { localTimeOf } from "../../localTime.ts";
import { limitWaitLineOf } from "../../progressLines.ts";
import { percentOf } from "../../transcriptFacts.ts";
import type { Run, RunWarning } from "../runState.ts";
import { SpecRunBase } from "../SpecRunBase.ts";

interface GuardedDecision {
  account: number;
  decision: GuardDecision;
}

export class LimitWaiter extends SpecRunBase {
  // Asks the limit guard about the Active account until it says launch, and returns that account.
  async _waitForLaunch(run: Run): Promise<number> {
    let hasAnnouncedWait = false;
    for (;;) {
      const { account, decision } = await this._guardDecisionOf(run);
      if (decision.kind === "launch") return account;
      const { window, utilization, until } = decision;
      if (!hasAnnouncedWait) {
        hasAnnouncedWait = true;
        await this._announce(
          run,
          limitWaitNoticeOf({
            account,
            reason: `is at ${percentOf(utilization)} of its ${windowNameOf(window)} limit`,
            until,
          }),
        );
      }
      await this._sleep(this._limitPollMsOf(until));
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
      await this._pollUntilUnderThresholds(run, undefined);
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
    await this._pollUntilUnderThresholds(run, until);
  }

  // Judges the Active account's cswap reading, each window raised to the last one a step's stream gave for it; with no reading, a step launches unguarded.
  private async _guardDecisionOf(run: Run): Promise<GuardedDecision> {
    const { account, usage } = await this._activeReadingOf(run);
    if (usage === undefined) {
      await this._warnOnce(
        run,
        "missing-reading",
        `No usage reading for account ${account}; steps launch unguarded.`,
      );
      return { account, decision: { kind: "launch" } };
    }
    const freshest = freshestUsageOf(usage, run.streamUsage.get(account));
    return { account, decision: decideStep(freshest, this.config.knobs) };
  }

  // Polls every idlePollMs, so a switch ends the wait within one poll.
  private _limitPollMsOf(until: Date): number {
    const { idlePollMs } = this.config.knobs;
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

  // Sleeps before each read, so a limit hit waits at least one poll; past `until` a stale reading keeps this wait going rather than announcing a second one.
  private async _pollUntilUnderThresholds(
    run: Run,
    until: Date | undefined,
  ): Promise<void> {
    for (;;) {
      if (until === undefined) {
        await this._sleep(this.config.knobs.idlePollMs);
      } else {
        await this._sleep(this._limitPollMsOf(until));
      }
      const { decision } = await this._guardDecisionOf(run);
      if (decision.kind === "launch") return;
    }
  }
}

// `until` undefined waits for no reset.
interface LimitWaitNotice {
  account: number;
  reason: string;
  until: Date | undefined;
}

function limitWaitNoticeOf({
  account,
  reason,
  until,
}: LimitWaitNotice): string {
  let continuing = "once the Active account reads under its thresholds";
  if (until !== undefined) continuing = `after ${localTimeOf(until)}`;
  return limitWaitLineOf(
    `account ${account} ${reason}; continuing ${continuing}. Switching to an account with headroom with cswap continues the run now.`,
  );
}

function hitWindowNameOf(window: keyof AccountUsage | undefined): string {
  if (window === undefined) return "usage";
  return windowNameOf(window);
}
