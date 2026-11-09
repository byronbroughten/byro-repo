// The landing lock: one file per primary checkout, held while a wrap-up fast-forwards that checkout's master.
// It is a PidLock, so it is stale only when its pid is no longer running on this host, and a live holder is
// always waited on. WrapUp/MasterFastForwarder.ts takes it.

import { join } from "node:path";

import { type LockWait, PidLock } from "./PidLock.ts";

const lockFileName = "landing.lock";

export class LandingLock extends PidLock {
  // gitDir is the primary checkout's own git folder, so the lock is never committed.
  static async acquire(gitDir: string, wait: LockWait): Promise<LandingLock> {
    const path = join(gitDir, lockFileName);
    return new LandingLock(path, await PidLock.takeWhenFree(path, wait));
  }
}
