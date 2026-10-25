import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { hostname, tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import type { IssueRef } from "./IssueWorkspaces.ts";
import type { LockHolder } from "./LandingLock.ts";
import { RunLock } from "./RunLock.ts";

const spec: IssueRef = { repo: "byro-repo", number: 213 };
let stateFolder: string;

beforeEach(() => {
  stateFolder = mkdtempSync(join(tmpdir(), "run-lock-"));
});

afterEach(() => {
  rmSync(stateFolder, { recursive: true, force: true });
});

function seedHolder(holder: LockHolder): void {
  writeFileSync(
    join(stateFolder, "byro-repo-213.run.lock"),
    JSON.stringify(holder),
  );
}

function deadPid(): number {
  return Number(execFileSync("node", ["-e", "console.log(process.pid)"]));
}

describe("RunLock.isHeld", () => {
  it("answers yes for a lock this host's running pid holds", () => {
    seedHolder({ pid: process.pid, host: hostname(), startedAt: "2026-01-01" });
    expect(RunLock.isHeld(stateFolder, spec)).toBe(true);
  });

  it("answers no for a lock whose pid has died", () => {
    seedHolder({ pid: deadPid(), host: hostname(), startedAt: "2026-01-01" });
    expect(RunLock.isHeld(stateFolder, spec)).toBe(false);
  });

  it("answers no with no lock", () => {
    expect(RunLock.isHeld(stateFolder, spec)).toBe(false);
  });

  it("answers no once the lock is released", () => {
    const taken = RunLock.take(stateFolder, spec);
    if (taken.kind !== "taken") throw new Error("Expected the lock taken.");
    taken.lock.release();
    expect(RunLock.isHeld(stateFolder, spec)).toBe(false);
  });
});
