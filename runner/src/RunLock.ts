// The run lock: one file per spec in the runner's state folder, held while that spec's run goes.
// It is a PidLock, as LandingLock.ts is, but a live holder is never waited on: the second run is refused.
// SpecRun/RunLoop.ts takes it.

import { mkdirSync } from "node:fs";
import { join } from "node:path";

import { fileStemOf, type IssueRef } from "./IssueWorkspaces.ts";
import { type HeldLock, PidLock } from "./PidLock.ts";

export interface HeldRunLock extends HeldLock {
  path: string;
}

export type RunLockTake = { kind: "taken"; lock: RunLock } | HeldRunLock;

export class RunLock extends PidLock {
  static take(stateFolder: string, spec: IssueRef): RunLockTake {
    mkdirSync(stateFolder, { recursive: true });
    const path = lockPathOf(stateFolder, spec);
    const attempt = PidLock.tryTake(path);
    if (attempt.kind === "taken") {
      return { kind: "taken", lock: new RunLock(path, attempt.holder) };
    }
    return { ...attempt, path };
  }

  static isHeld(stateFolder: string, spec: IssueRef): boolean {
    return PidLock.isHeldAt(lockPathOf(stateFolder, spec));
  }
}

function lockPathOf(stateFolder: string, spec: IssueRef): string {
  return join(stateFolder, `${fileStemOf(spec)}.run.lock`);
}
