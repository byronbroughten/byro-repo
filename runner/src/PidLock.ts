// The pid lock LandingLock.ts and RunLock.ts share: a file holding its holder's pid, host, start time and token.
// It is stale only when that pid is no longer running on this host; there is no time-based expiry.
// tryTake() never waits: LandingLock polls a live holder and RunLock refuses on one.
// A stale lock is taken over only while holding a `<path>.takeover` guard, so two takers can't both win.

import { randomUUID } from "node:crypto";
import { existsSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { hostname } from "node:os";

export interface LockHolder {
  pid: number;
  host: string;
  startedAt: string;
  token: string; // Tells apart two holders sharing a pid.
}

export interface HeldLock {
  kind: "held";
  holder: LockHolder | undefined; // An unreadable lock has no holder to name.
}

export type LockAttempt = { kind: "taken"; holder: LockHolder } | HeldLock;

export class PidLock {
  readonly path: string;
  readonly holder: LockHolder;

  constructor(path: string, holder: LockHolder) {
    this.path = path;
    this.holder = holder;
  }

  // beforeTakeover lets a test run a second taker between finding a stale lock and taking it over.
  static tryTake(path: string, beforeTakeover?: () => void): LockAttempt {
    const holder: LockHolder = {
      pid: process.pid,
      host: hostname(),
      startedAt: new Date().toISOString(),
      token: randomUUID(),
    };
    for (;;) {
      if (tryCreate(path, holder)) return { kind: "taken", holder };
      const current = readHolder(path);
      if (current === undefined || !isStale(current)) {
        return { kind: "held", holder: current };
      }
      beforeTakeover?.();
      if (!takeGuard(path, holder)) {
        return { kind: "held", holder: readHolder(guardPathOf(path)) };
      }
      if (takeOver(path, current, holder)) return { kind: "taken", holder };
    }
  }

  static isHeldAt(path: string): boolean {
    if (!existsSync(path)) return false;
    const holder = readHolder(path);
    return holder === undefined || !isStale(holder);
  }

  release(): void {
    if (isSameHolder(readHolder(this.path), this.holder)) {
      rmSync(this.path, { force: true });
    }
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

function isStale(holder: LockHolder): boolean {
  return holder.host === hostname() && !isRunning(holder.pid);
}

// A live guard answers held rather than looping, since an unreadable or reused-pid guard may never clear.
function takeGuard(path: string, holder: LockHolder): boolean {
  const guardPath = guardPathOf(path);
  if (tryCreate(guardPath, holder)) return true;
  const guard = readHolder(guardPath);
  if (guard === undefined || !isStale(guard)) return false;
  // Two takers clearing one dead guard can still both proceed; a crash inside the guard is microseconds wide.
  rmSync(guardPath, { force: true });
  return tryCreate(guardPath, holder);
}

function guardPathOf(path: string): string {
  return `${path}.takeover`;
}

function takeOver(
  path: string,
  stale: LockHolder,
  holder: LockHolder,
): boolean {
  try {
    if (!isSameHolder(readHolder(path), stale)) return false;
    rmSync(path, { force: true });
    return tryCreate(path, holder);
  } finally {
    rmSync(guardPathOf(path), { force: true });
  }
}

function isSameHolder(
  read: LockHolder | undefined,
  holder: LockHolder,
): boolean {
  return read?.pid === holder.pid && read.token === holder.token;
}

function isRunning(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === "EPERM";
  }
}
