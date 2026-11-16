import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { hostname, tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { AccountLease } from "./AccountLease.ts";
import { liveHolder, notRunningPid, seedHolder } from "./lockFixture.ts";
import type { LockHolder } from "./PidLock.ts";

let stateFolder: string;

beforeEach(() => {
  stateFolder = mkdtempSync(join(tmpdir(), "account-lease-"));
});

afterEach(() => {
  rmSync(stateFolder, { recursive: true, force: true });
});

function leasePath(account: number): string {
  return join(stateFolder, `account-${account}.lease`);
}

function holderAt(path: string): LockHolder {
  return JSON.parse(readFileSync(path, "utf8")) as LockHolder;
}

describe("AccountLease.take", () => {
  it("takes a free account's lease as this process", () => {
    const take = AccountLease.take(stateFolder, 2);
    expect(take.kind).toBe("taken");
    expect(holderAt(leasePath(2)).pid).toBe(process.pid);
  });

  it("refuses an account a live holder has leased, naming the holder", () => {
    seedHolder(leasePath(2), liveHolder());
    const take = AccountLease.take(stateFolder, 2);
    expect(take.kind).toBe("held");
    expect(take.kind === "held" && take.holder?.pid).toBe(process.pid);
  });

  it("takes over a lease its dead holder abandoned", () => {
    seedHolder(leasePath(2), {
      pid: notRunningPid,
      host: hostname(),
      startedAt: "2026-01-01",
    });
    expect(AccountLease.take(stateFolder, 2).kind).toBe("taken");
    expect(holderAt(leasePath(2)).pid).toBe(process.pid);
  });

  it("leaves another account's lease alone", () => {
    seedHolder(leasePath(1), liveHolder());
    expect(AccountLease.take(stateFolder, 2).kind).toBe("taken");
  });
});

describe("release", () => {
  it("frees the account for the next taker", () => {
    const take = AccountLease.take(stateFolder, 2);
    if (take.kind !== "taken") throw new Error("Expected the lease taken.");
    take.lease.release();
    expect(existsSync(leasePath(2))).toBe(false);
  });
});

describe("AccountLease.leasedIn", () => {
  it("lists each account a live holder has leased with its holder, by account", () => {
    seedHolder(leasePath(3), liveHolder());
    seedHolder(leasePath(1), liveHolder());
    seedHolder(leasePath(2), {
      pid: notRunningPid,
      host: hostname(),
      startedAt: "2026-01-01",
    });
    const leased = AccountLease.leasedIn(stateFolder);
    expect(leased.map(({ account }) => account)).toEqual([1, 3]);
    expect(leased[0]?.holder?.pid).toBe(process.pid);
  });

  it("lists none for a state folder not made yet", () => {
    expect(AccountLease.leasedIn(join(stateFolder, "missing"))).toEqual([]);
  });
});
