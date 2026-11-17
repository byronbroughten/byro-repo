// The Accounts section the Run board shows: a heading and accountLine.ts's line for each account.
// It reads usage through limitGuard.ts's usage reader, at most once per refresh interval, and the holders through AccountLease.ts on each render.
// The caller passes the live steps' stream readings, which accountLine.ts applies.

import type { AccountLeaseReader } from "./AccountLease.ts";
import { accountLine } from "./accountLine.ts";
import { messageOf } from "./failureText.ts";
import type { StreamUsage, UsageList, UsageReader } from "./limitGuard.ts";

export interface AccountsSectionPorts {
  usageReader: UsageReader;
  leaseReader: AccountLeaseReader;
  // Undefined reads once and never again, as `runner status` does.
  refreshMs: number | undefined;
}

type SectionRead = { readAt: Date } & (
  { kind: "read"; usageList: UsageList } | { kind: "failed"; reason: string }
);

export class AccountsSection {
  private readonly ports: AccountsSectionPorts;
  private lastRead: SectionRead | undefined;

  constructor(ports: AccountsSectionPorts) {
    this.ports = ports;
  }

  static init(ports: AccountsSectionPorts): AccountsSection {
    return new AccountsSection(ports);
  }

  async textAt(now: Date, streamUsage?: StreamUsage): Promise<string> {
    const read = await this._readAt(now);
    if (read.kind === "failed") {
      return `Accounts: cswap unreadable (${read.reason})`;
    }
    const lines = accountLine.linesOf({
      usageList: read.usageList,
      leased: this.ports.leaseReader.read(),
      now,
      streamUsage,
    });
    return [this._headingAt(now, read), ...lines].join("\n");
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
