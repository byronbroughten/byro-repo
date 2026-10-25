// The pid lock LandingLock.ts and RunLock.ts share: a file holding its holder's pid, host and start time.
// It is stale only when that pid is no longer running on this host; there is no time-based expiry.
// tryTake() never waits: LandingLock polls a live holder and RunLock refuses on one.

import { existsSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { hostname } from "node:os";

export interface LockHolder {
  pid: number;
  host: string;
  startedAt: string;
}

export interface HeldLock {
  kind: "held";
  holder: LockHolder | undefined; // An unreadable lock has no holder to name.
}

export type LockAttempt = { kind: "taken" } | HeldLock;

export class PidLock {
  readonly path: string;

  constructor(path: string) {
    this.path = path;
  }

  static tryTake(path: string): LockAttempt {
    const holder: LockHolder = {
      pid: process.pid,
      host: hostname(),
      startedAt: new Date().toISOString(),
    };
    for (;;) {
      if (tryCreate(path, holder)) return { kind: "taken" };
      const current = readHolder(path);
      if (!isStale(current)) return { kind: "held", holder: current };
      rmSync(path, { force: true });
    }
  }

  static isHeldAt(path: string): boolean {
    return existsSync(path) && !isStale(readHolder(path));
  }

  release(): void {
    rmSync(this.path, { force: true });
  }
}

function tryCreate(path: string, holder: LockHolder): boolean {
  try {
    writeFileSync(path, JSON.stringify(holder), { flag: "wx" });
    return true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "EEXIST") return false;
    throw error;
  }
}

// An unreadable lock may be mid-write by its holder, so it counts as live.
function readHolder(path: string): LockHolder | undefined {
  try {
    return JSON.parse(readFileSync(path, "utf8")) as LockHolder;
  } catch {
    return undefined;
  }
}

function isStale(holder: LockHolder | undefined): boolean {
  if (holder === undefined || holder.host !== hostname()) return false;
  return !isRunning(holder.pid);
}

function isRunning(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === "EPERM";
  }
}
