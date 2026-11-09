// The pid-lock fixtures LandingLock's, RunLock's, Checks', SupervisionRecords' and SpecRun's run-lock tests share.

import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { writeFileSync } from "node:fs";
import { hostname } from "node:os";

import type { LockHolder } from "./PidLock.ts";

export function seedHolder(
  path: string,
  holder: Omit<LockHolder, "token">,
): void {
  writeFileSync(path, JSON.stringify({ ...holder, token: randomUUID() }));
}

// A holder this test process is, so it counts as live.
export function liveHolder(): Omit<LockHolder, "token"> {
  return {
    pid: process.pid,
    host: hostname(),
    startedAt: new Date().toISOString(),
  };
}

export function deadPid(): number {
  return Number(execFileSync("node", ["-e", "console.log(process.pid)"]));
}
