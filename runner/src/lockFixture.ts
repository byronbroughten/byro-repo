// The pid-lock fixtures LandingLock's, RunLock's, SupervisionRecords' and SpecRun's run-lock tests share.

import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { writeFileSync } from "node:fs";

import type { LockHolder } from "./PidLock.ts";

export function seedHolder(
  path: string,
  holder: Omit<LockHolder, "token">,
): void {
  writeFileSync(path, JSON.stringify({ ...holder, token: randomUUID() }));
}

export function deadPid(): number {
  return Number(execFileSync("node", ["-e", "console.log(process.pid)"]));
}
