// The check slot: one file in the primary's state folder, next to the check stamps, held while `npm run check` runs.
// It is a PidLock, as LandingLock.ts is, and a live holder is waited on with no time limit; Checks.ts takes it.

import { mkdirSync } from "node:fs";
import { join } from "node:path";

import { type LockWait, PidLock } from "./PidLock.ts";

const slotFileName = "check.slot";

export class CheckSlot extends PidLock {
  static async acquire(
    stateFolder: string,
    wait: LockWait,
  ): Promise<CheckSlot> {
    mkdirSync(stateFolder, { recursive: true });
    const path = join(stateFolder, slotFileName);
    return new CheckSlot(path, await PidLock.takeWhenFree(path, wait));
  }
}
