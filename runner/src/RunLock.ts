// The run lock: one file per spec in the runner's state folder, held while that spec's run goes, so a second run is refused.
// It holds the holder's pid, host and start time, as LandingLock.ts's does, and is stale only when that pid is no longer
// running on this host; a live holder is never waited on. SpecRun/RunLoop.ts takes it.

import { existsSync, mkdirSync, rmSync } from "node:fs";
import { hostname } from "node:os";
import { join } from "node:path";

import { fileStemOf, type IssueRef } from "./IssueWorkspaces.ts";
import {
  isStale,
  type LockHolder,
  readHolder,
  tryCreate,
} from "./LandingLock.ts";

export interface HeldRunLock {
  kind: "held";
  holder: LockHolder | undefined; // An unreadable lock has no holder to name.
  path: string;
}

export type RunLockTake = { kind: "taken"; lock: RunLock } | HeldRunLock;

export class RunLock {
  readonly path: string;

  constructor(path: string) {
    this.path = path;
  }

  static take(stateFolder: string, spec: IssueRef): RunLockTake {
    mkdirSync(stateFolder, { recursive: true });
    const path = lockPathOf(stateFolder, spec);
    const holder: LockHolder = {
      pid: process.pid,
      host: hostname(),
      startedAt: new Date().toISOString(),
    };
    for (;;) {
      if (tryCreate(path, holder)) {
        return { kind: "taken", lock: new RunLock(path) };
      }
      const current = readHolder(path);
      if (!isStale(current)) return { kind: "held", holder: current, path };
      rmSync(path, { force: true });
    }
  }

  static isHeld(stateFolder: string, spec: IssueRef): boolean {
    const path = lockPathOf(stateFolder, spec);
    return existsSync(path) && !isStale(readHolder(path));
  }

  release(): void {
    rmSync(this.path, { force: true });
  }
}

function lockPathOf(stateFolder: string, spec: IssueRef): string {
  return join(stateFolder, `${fileStemOf(spec)}.run.lock`);
}
