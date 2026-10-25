// The landing lock: one file per primary checkout, held while a wrap-up fast-forwards that checkout's master.
// It is a PidLock, so it is stale only when its pid is no longer running on this host, and a live holder is
// always waited on. WrapUp.ts takes it.

import { join } from "node:path";

import { PidLock } from "./PidLock.ts";

const lockFileName = "landing.lock";

export interface LandingLockOptions {
  pollMs: number;
  sleep(ms: number): Promise<void>;
}

export class LandingLock extends PidLock {
  // gitDir is the primary checkout's own git folder, so the lock is never committed.
  static async acquire(
    gitDir: string,
    { pollMs, sleep }: LandingLockOptions,
  ): Promise<LandingLock> {
    const path = join(gitDir, lockFileName);
    while (PidLock.tryTake(path).kind === "held") await sleep(pollMs);
    return new LandingLock(path);
  }
}
