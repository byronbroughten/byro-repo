// The landing lock: one file per primary checkout, held while a wrap-up fast-forwards that checkout's master.
// It holds the holder's pid, host and start time, and is stale only when that pid is no longer running on this host;
// there is no time-based expiry, so a live holder is always waited on. WrapUp.ts takes it.

import { readFileSync, rmSync, writeFileSync } from "node:fs";
import { hostname } from "node:os";
import { join } from "node:path";

const lockFileName = "landing.lock";

export interface LockHolder {
  pid: number;
  host: string;
  startedAt: string;
}

export interface LandingLockOptions {
  pollMs: number;
  sleep(ms: number): Promise<void>;
}

export class LandingLock {
  readonly path: string;

  constructor(path: string) {
    this.path = path;
  }

  // gitDir is the primary checkout's own git folder, so the lock is never committed.
  static async acquire(
    gitDir: string,
    { pollMs, sleep }: LandingLockOptions,
  ): Promise<LandingLock> {
    const path = join(gitDir, lockFileName);
    const holder: LockHolder = {
      pid: process.pid,
      host: hostname(),
      startedAt: new Date().toISOString(),
    };
    for (;;) {
      if (tryCreate(path, holder)) return new LandingLock(path);
      if (isStale(readHolder(path))) {
        rmSync(path, { force: true });
        continue;
      }
      await sleep(pollMs);
    }
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
