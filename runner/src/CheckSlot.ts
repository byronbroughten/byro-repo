// The check slot: one file in the primary's state folder, next to the check stamps, held while `npm run check` runs.
// It is a PidLock, as LandingLock.ts is, and a live holder is waited on with no time limit; Checks.ts takes it.

import { mkdirSync } from "node:fs";
import { join } from "node:path";

import { PidLock } from "./PidLock.ts";
import { sleep } from "./sleep.ts";

const slotFileName = "check.slot";

export interface CheckSlotOptions {
  pollMs: number;
  // Called once, when the first try finds the slot held; the pid is undefined while the holder's file is unreadable.
  onHeld(pid: number | undefined): void;
}

export class CheckSlot extends PidLock {
  static async take(
    stateFolder: string,
    { pollMs, onHeld }: CheckSlotOptions,
  ): Promise<CheckSlot> {
    mkdirSync(stateFolder, { recursive: true });
    const path = join(stateFolder, slotFileName);
    let isWaiting = false;
    for (;;) {
      const attempt = PidLock.tryTake(path);
      if (attempt.kind === "taken") {
        return new CheckSlot(path, attempt.holder);
      }
      if (!isWaiting) onHeld(attempt.holder?.pid);
      isWaiting = true;
      await sleep(pollMs);
    }
  }
}
