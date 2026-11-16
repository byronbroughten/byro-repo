// The Accounts section the Run board shows, and the account line it and accountSwitch.ts print for each account.
// It reads usage through limitGuard.ts's usage reader, at most once per refresh interval, and the holders through AccountLease.ts on each render.
// Each window takes a live step's stream reading when it is higher, by limitGuard.ts's freshestUsageOf; the caller finds the streams.

import type { AccountLeaseReader, LeasedAccount } from "./AccountLease.ts";
import type { UsageReading, UsageWindow } from "./AgentStep.ts";
import { messageOf } from "./failureText.ts";
import {
  type AccountReading,
  freshestUsageOf,
  isUnstartedWindow,
  type UsageList,
  type UsageReader,
} from "./limitGuard.ts";
import { localTimeOf } from "./localTime.ts";
import type { LockHolder } from "./PidLock.ts";
import { percentOf } from "./transcriptFacts.ts";

export interface AccountsSectionPorts {
  usageReader: UsageReader;
  leaseReader: AccountLeaseReader;
  // Undefined reads once and never again, as `runner status` does.
  refreshMs: number | undefined;
}

export interface AccountLinesRequest {
  usageList: UsageList;
  leased: LeasedAccount[];
  now: Date;
  streamUsage?: ReadonlyMap<number, UsageReading>;
}

type SectionRead = { readAt: Date } & (
  { kind: "read"; usageList: UsageList } | { kind: "failed"; reason: string }
);

const minuteMs = 60_000;

export class AccountsSection {
  private readonly ports: AccountsSectionPorts;
  private lastRead: SectionRead | undefined;

  constructor(ports: AccountsSectionPorts) {
    this.ports = ports;
  }

  static init(ports: AccountsSectionPorts): AccountsSection {
    return new AccountsSection(ports);
  }

  async textAt(
    now: Date,
    streamUsage?: ReadonlyMap<number, UsageReading>,
  ): Promise<string> {
    const read = await this._readAt(now);
    if (read.kind === "failed") {
      return `Accounts: cswap unreadable (${read.reason})`;
    }
    const lines = accountLinesOf({
      usageList: read.usageList,
      leased: this.ports.leaseReader.read(),
      now,
      streamUsage,
    });
    return [
      this._headingAt(now, read),
      ...lines.map((line) => `  ${line}`),
    ].join("\n");
  }

  private async _readAt(now: Date): Promise<SectionRead> {
    if (this.lastRead === undefined || this._isReadDue(this.lastRead, now)) {
      this.lastRead = await this._read(now);
    }
    return this.lastRead;
  }

  private _isReadDue(lastRead: SectionRead, now: Date): boolean {
    const { refreshMs } = this.ports;
    if (refreshMs === undefined) return false;
    return now.getTime() - lastRead.readAt.getTime() >= refreshMs;
  }

  private async _read(now: Date): Promise<SectionRead> {
    try {
      const usageList = await this.ports.usageReader.read();
      return { kind: "read", usageList, readAt: now };
    } catch (error) {
      return { kind: "failed", reason: messageOf(error), readAt: now };
    }
  }

  private _headingAt(now: Date, read: SectionRead): string {
    const ageSeconds = Math.floor(
      (now.getTime() - read.readAt.getTime()) / 1000,
    );
    if (this.ports.refreshMs === undefined || ageSeconds < 1) {
      return "Accounts";
    }
    return `Accounts (read ${ageSeconds}s ago)`;
  }
}

// One line per account, by account number, as the Run board and `npm run account:switch` both print them.
export function accountLinesOf({
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
        `${reading.account}.${isActive ? " (active)" : ""} ${usageLabelOf(reading, now, streamUsage)}`,
      ];
      const lease = leased.find(({ account }) => account === reading.account);
      if (lease !== undefined) parts.push(heldByLabelOf(lease.holder));
      return parts.join(", ");
    });
}

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

// Days and hours past a day, hours and minutes below it; a reset already past reads as 0h 0m.
function untilResetOf(resetsAt: Date, now: Date): string {
  const minutes = Math.max(
    0,
    Math.floor((resetsAt.getTime() - now.getTime()) / minuteMs),
  );
  const hours = Math.floor(minutes / 60);
  if (hours >= 24) return `${Math.floor(hours / 24)}d ${hours % 24}h`;
  return `${hours}h ${minutes % 60}m`;
}

// Names a leased account's holder as AccountLease.ts lists it.
export function heldByLabelOf(holder: LockHolder | undefined): string {
  if (holder === undefined) return "held by an unreadable lease";
  return `held by pid ${holder.pid} since ${localTimeOf(new Date(holder.startedAt))}`;
}
