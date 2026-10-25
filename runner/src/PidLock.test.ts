import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { hostname, tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { deadPid, seedHolder } from "./lockFixture.ts";
import { type LockAttempt, type LockHolder, PidLock } from "./PidLock.ts";

let folder: string;

beforeEach(() => {
  folder = mkdtempSync(join(tmpdir(), "pid-lock-"));
});

afterEach(() => {
  rmSync(folder, { recursive: true, force: true });
});

function lockPath(): string {
  return join(folder, "test.lock");
}

function seedDeadHolder(path: string): void {
  seedHolder(path, {
    pid: deadPid(),
    host: hostname(),
    startedAt: "2026-01-01",
  });
}

function readLock(): LockHolder {
  return JSON.parse(readFileSync(lockPath(), "utf8")) as LockHolder;
}

function expectTaken(attempt: LockAttempt): LockHolder {
  if (attempt.kind !== "taken") throw new Error("Expected the lock taken.");
  return attempt.holder;
}

describe("PidLock.tryTake", () => {
  it("lets exactly one of two takers racing for a dead holder's lock win", () => {
    seedDeadHolder(lockPath());
    let second: LockHolder | undefined;
    const first = PidLock.tryTake(lockPath(), () => {
      second = expectTaken(PidLock.tryTake(lockPath()));
    });
    expect(first.kind).toBe("held");
    expect(readLock().token).toBe(second?.token);
  });

  it("takes over past a takeover guard its dead holder left behind", () => {
    seedDeadHolder(lockPath());
    seedDeadHolder(`${lockPath()}.takeover`);
    const holder = expectTaken(PidLock.tryTake(lockPath()));
    expect(readLock().token).toBe(holder.token);
    expect(existsSync(`${lockPath()}.takeover`)).toBe(false);
  });

  it("answers held, naming the guard's holder, while a live taker holds the guard", () => {
    seedDeadHolder(lockPath());
    seedHolder(`${lockPath()}.takeover`, {
      pid: process.pid,
      host: hostname(),
      startedAt: "2026-01-01",
    });
    const attempt = PidLock.tryTake(lockPath());
    expect([attempt.kind, attempt.holder?.pid]).toEqual(["held", process.pid]);
  });
});

describe("release", () => {
  it("leaves alone a lock that names another holder", () => {
    const holder = expectTaken(PidLock.tryTake(lockPath()));
    rmSync(lockPath());
    const other = expectTaken(PidLock.tryTake(lockPath()));
    new PidLock(lockPath(), holder).release();
    expect(readLock().token).toBe(other.token);
  });

  it("removes a lock that names its own holder", () => {
    const holder = expectTaken(PidLock.tryTake(lockPath()));
    new PidLock(lockPath(), holder).release();
    expect(existsSync(lockPath())).toBe(false);
  });
});
