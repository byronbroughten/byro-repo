import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { hostname, tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { LandingLock } from "./LandingLock.ts";
import { deadPid, seedHolder } from "./lockFixture.ts";
import type { LockHolder } from "./PidLock.ts";

let gitDir: string;

beforeEach(() => {
  gitDir = mkdtempSync(join(tmpdir(), "landing-lock-"));
});

afterEach(() => {
  rmSync(gitDir, { recursive: true, force: true });
});

function lockPath(): string {
  return join(gitDir, "landing.lock");
}

describe("LandingLock.acquire", () => {
  it("writes this process's pid, host and start time", async () => {
    await LandingLock.acquire(gitDir, { pollMs: 1, sleep: async () => {} });
    const holder = JSON.parse(readFileSync(lockPath(), "utf8")) as LockHolder;
    expect([holder.pid, holder.host]).toEqual([process.pid, hostname()]);
    expect(Number.isNaN(Date.parse(holder.startedAt))).toBe(false);
  });

  it("takes over a lock whose pid is no longer running on this host", async () => {
    seedHolder(lockPath(), {
      pid: deadPid(),
      host: hostname(),
      startedAt: "2026-01-01",
    });
    let waits = 0;
    await LandingLock.acquire(gitDir, {
      pollMs: 1,
      sleep: async () => {
        waits += 1;
      },
    });
    expect(waits).toBe(0);
    const holder = JSON.parse(readFileSync(lockPath(), "utf8")) as LockHolder;
    expect(holder.pid).toBe(process.pid);
  });

  it("waits on a live holder until it releases", async () => {
    seedHolder(lockPath(), {
      pid: process.pid,
      host: hostname(),
      startedAt: "2026-01-01",
    });
    let waits = 0;
    await LandingLock.acquire(gitDir, {
      pollMs: 1,
      async sleep() {
        waits += 1;
        if (waits === 2) rmSync(lockPath());
      },
    });
    expect(waits).toBe(2);
  });

  it("waits on another host's lock even when the pid is dead here", async () => {
    seedHolder(lockPath(), {
      pid: deadPid(),
      host: "elsewhere",
      startedAt: "2026-01-01",
    });
    let waits = 0;
    await LandingLock.acquire(gitDir, {
      pollMs: 1,
      async sleep() {
        waits += 1;
        rmSync(lockPath());
      },
    });
    expect(waits).toBe(1);
  });
});

describe("release", () => {
  it("removes the lock file", async () => {
    const lock = await LandingLock.acquire(gitDir, {
      pollMs: 1,
      sleep: async () => {},
    });
    lock.release();
    expect(existsSync(lockPath())).toBe(false);
  });
});
