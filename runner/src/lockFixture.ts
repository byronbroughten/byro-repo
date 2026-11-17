// The pid-lock fixtures LandingLock's, RunLock's, AccountLease's, Checks', SupervisionRecords' and SpecRun's run-lock tests share;
// the workspace-lease and process-identity tests take its pid that isn't running.

import { randomUUID } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { hostname } from "node:os";

import type { LockHolder } from "./PidLock.ts";

export function seedHolder(
  path: string,
  holder: Omit<LockHolder, "token">,
): void {
  writeFileSync(path, JSON.stringify({ ...holder, token: randomUUID() }));
}

export function holderAt(path: string): LockHolder {
  return JSON.parse(readFileSync(path, "utf8")) as LockHolder;
}

// A holder this test process is, so it counts as live.
export function liveHolder(): Omit<LockHolder, "token"> {
  return {
    pid: process.pid,
    host: hostname(),
    startedAt: new Date().toISOString(),
  };
}

// Above any pid the OS hands out, so it reads as dead without starting a process.
export const notRunningPid = 2 ** 30;

// A holder on this host whose pid isn't running, so its lock reads as abandoned.
export function deadHolder(): Omit<LockHolder, "token"> {
  return { pid: notRunningPid, host: hostname(), startedAt: "2026-01-01" };
}
