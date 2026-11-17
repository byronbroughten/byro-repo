import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { AccountLease } from "./AccountLease.ts";
import { deadHolder, holderAt, liveHolder, seedHolder } from "./lockFixture.ts";

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

const account2 = { account: 2, spec: "byro-repo #763", kind: "run" } as const;

describe("AccountLease.take", () => {
  it("takes a free account's lease as this process, recording its spec and kind", () => {
    const take = AccountLease.take(stateFolder, account2);
    expect(take.kind).toBe("taken");
    expect(holderAt(leasePath(2))).toMatchObject({
      pid: process.pid,
      spec: "byro-repo #763",
      kind: "run",
    });
  });

  it("refuses an account a live holder has leased, naming the holder", () => {
    seedHolder(leasePath(2), liveHolder());
    const take = AccountLease.take(stateFolder, account2);
    expect(take.kind).toBe("held");
    expect(take.kind === "held" && take.holder?.pid).toBe(process.pid);
  });

  it("takes over a lease its dead holder abandoned", () => {
    seedHolder(leasePath(2), deadHolder());
    expect(AccountLease.take(stateFolder, account2).kind).toBe("taken");
    expect(holderAt(leasePath(2)).pid).toBe(process.pid);
  });

  it("leaves another account's lease alone", () => {
    seedHolder(leasePath(1), liveHolder());
    expect(AccountLease.take(stateFolder, account2).kind).toBe("taken");
  });
});

describe("release", () => {
  it("frees the account for the next taker", () => {
    const take = AccountLease.take(stateFolder, account2);
    if (take.kind !== "taken") throw new Error("Expected the lease taken.");
    take.lease.release();
    expect(existsSync(leasePath(2))).toBe(false);
  });
});

describe("AccountLease.leasedIn", () => {
  it("lists each account a live holder has leased with its holder, by account", () => {
    seedHolder(leasePath(3), liveHolder());
    seedHolder(leasePath(1), liveHolder());
    seedHolder(leasePath(2), deadHolder());
    const leased = AccountLease.leasedIn(stateFolder);
    expect(leased.map(({ account }) => account)).toEqual([1, 3]);
    expect(leased[0]?.holder?.pid).toBe(process.pid);
  });

  it("lists none for a state folder not made yet", () => {
    expect(AccountLease.leasedIn(join(stateFolder, "missing"))).toEqual([]);
  });
});

describe("AccountLease.accountHeldBy", () => {
  const spec = "byro-repo #763";

  it("names a run's account, passing over a session's lease on the same spec", () => {
    seedHolder(leasePath(1), { ...liveHolder(), spec, kind: "session" });
    seedHolder(leasePath(2), { ...liveHolder(), spec, kind: "run" });
    expect(AccountLease.accountHeldBy(stateFolder, spec)).toBe(2);
  });

  it("names no account when only a session holds one on the spec", () => {
    seedHolder(leasePath(1), { ...liveHolder(), spec, kind: "session" });
    expect(AccountLease.accountHeldBy(stateFolder, spec)).toBeUndefined();
  });

  it("reads a lease with no kind as a run's", () => {
    seedHolder(leasePath(3), { ...liveHolder(), spec });
    expect(AccountLease.accountHeldBy(stateFolder, spec)).toBe(3);
  });
});
