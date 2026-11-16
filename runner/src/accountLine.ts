// The account line AccountsSection.ts and accountSwitch.ts print for each account, under a heading of their own.
// Each window takes a live step's stream reading when it is higher, by limitGuard.ts's freshestUsageOf; the caller finds the streams.

import type { LeasedAccount } from "./AccountLease.ts";
import type { UsageReading, UsageWindow } from "./AgentStep.ts";
import {
  type AccountReading,
  freshestUsageOf,
  isUnstartedWindow,
  type UsageList,
} from "./limitGuard.ts";
import { localTimeOf } from "./localTime.ts";
import { percentOf } from "./transcriptFacts.ts";

export interface AccountLinesRequest {
  usageList: UsageList;
  leased: LeasedAccount[];
  now: Date;
  streamUsage?: ReadonlyMap<number, UsageReading>;
}

const minuteMs = 60_000;

export const accountLine = {
  // Indented, since both callers print the lines under a heading.
  linesOf({
    usageList,
    leased,
    now,
    streamUsage,
  }: AccountLinesRequest): string[] {
    return [...usageList.readings]
      .sort((a, b) => a.account - b.account)
      .map((reading) => {
        const isActive = reading.account === usageList.activeAccount;
        const parts = [
          `  ${reading.account}.${isActive ? " (active)" : ""} ${usageLabelOf(reading, now, streamUsage)}`,
        ];
        const holder = accountLine.holderLabelOf(reading.account, leased);
        if (holder !== undefined) parts.push(holder);
        return parts.join(", ");
      });
  },

  // Undefined for a free account.
  holderLabelOf(account: number, leased: LeasedAccount[]): string | undefined {
    const lease = leased.find((each) => each.account === account);
    if (lease === undefined) return undefined;
    const { holder } = lease;
    if (holder === undefined) return "held by an unreadable lease";
    // A lease taken before holders recorded their spec names its process instead.
    if (holder.spec !== undefined) return `held by ${holder.spec}`;
    return `held by pid ${holder.pid} since ${localTimeOf(new Date(holder.startedAt))}`;
  },
};

function usageLabelOf(
  { account, usage, isDisabled }: AccountReading,
  now: Date,
  streamUsage: ReadonlyMap<number, UsageReading> | undefined,
): string {
  if (isDisabled === true) return "disabled";
  if (usage === undefined) return "no reading";
  const fresh = freshestUsageOf(usage, streamUsage?.get(account));
  return `5h: ${windowLabelOf(fresh.fiveHour, now)}, 7d: ${windowLabelOf(fresh.sevenDay, now)}`;
}

function windowLabelOf(window: UsageWindow, now: Date): string {
  const percent = percentOf(window.utilization);
  if (isUnstartedWindow(window)) return percent;
  return `${percent} (${untilResetOf(window.resetsAt, now)})`;
}

function untilResetOf(resetsAt: Date, now: Date): string {
  const minutes = Math.max(
    0,
    Math.floor((resetsAt.getTime() - now.getTime()) / minuteMs),
  );
  const hours = Math.floor(minutes / 60);
  if (hours >= 24) return `${Math.floor(hours / 24)}d ${hours % 24}h`;
  return `${hours}h ${minutes % 60}m`;
}
