// The run lock: one file per spec in the runner's state folder, held while that spec's run goes.
// It is a PidLock, as LandingLock.ts is, but a live holder is never waited on: the second run is refused.
// SpecRun/PreflightChecker.ts takes it; SpecRun/RunLoop.ts releases it.

import { existsSync, mkdirSync, readdirSync } from "node:fs";
import { join } from "node:path";

import { type IssueRef, issueRef } from "./IssueWorkspaces.ts";
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

  // The held lock's file, or undefined when no live run holds it.
  static heldPathOf(stateFolder: string, spec: IssueRef): string | undefined {
    const path = lockPathOf(stateFolder, spec);
    return PidLock.isHeldAt(path) ? path : undefined;
  }

  // A Batch is live while any member's run lock is held.
  static isAnyHeld(stateFolder: string, specs: IssueRef[]): boolean {
    return specs.some((spec) => RunLock.isHeld(stateFolder, spec));
  }

  // Every spec with a lock file, held or left behind by a dead pid.
  static specsOf(stateFolder: string): IssueRef[] {
    if (!existsSync(stateFolder)) return [];
    return readdirSync(stateFolder)
      .filter((name) => name.endsWith(lockSuffix))
      .sort()
      .map((name) => issueRef.ofFileStem(name.slice(0, -lockSuffix.length)));
  }
}

const lockSuffix = ".run.lock";

function lockPathOf(stateFolder: string, spec: IssueRef): string {
  return join(stateFolder, `${issueRef.fileStemOf(spec)}${lockSuffix}`);
}
