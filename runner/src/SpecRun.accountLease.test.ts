import { existsSync, mkdirSync, readdirSync, rmSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it, vi } from "vitest";

import { AccountLease } from "./AccountLease.ts";
import { FakeAgentStep } from "./FakeAgentStep.ts";
import { issueRef } from "./IssueWorkspaces.ts";
import type { UsageReader } from "./limitGuard.ts";
import { deadHolder, holderAt, liveHolder, seedHolder } from "./lockFixture.ts";
import type { LockHolder } from "./PidLock.ts";
import {
  accountsListOf,
  addIssue,
  addSpec,
  blocked,
  github,
  implemented,
  noticeSummaries,
  refOf,
  reviewed,
  scriptUsage,
  spec,
  specRun,
  stateFolder,
  usageListOf,
  useSpecRunHarness,
} from "./specRunHarness.ts";
import type { Blocker } from "./stepRecords.ts";

useSpecRunHarness();

function leasePathOf(account: number): string {
  return join(stateFolder(), `account-${account}.lease`);
}

function leaseFiles(): string[] {
  if (!existsSync(stateFolder())) return [];
  return readdirSync(stateFolder()).filter((name) => name.endsWith(".lease"));
}

// Another run's lease on `account`, live or abandoned.
function seedLease(account: number, isLive: boolean): void {
  mkdirSync(stateFolder(), { recursive: true });
  seedHolder(leasePathOf(account), isLive ? liveHolder() : deadHolder());
}

function accountsOf(agentStep: FakeAgentStep): (number | undefined)[] {
  return agentStep.requests.map(({ account }) => account);
}

// Account 1 at a 5-hour reading a step moves; the Active account 2 idle and account 3 at 20%, so account 3 ranks first off account 1.
function movingAccount1(): {
  usageReader: UsageReader;
  to(fiveHour: number): () => void;
} {
  let account1FiveHour = 0.1;
  return {
    usageReader: {
      read: async () =>
        accountsListOf(
          [
            { account: 1, fiveHour: account1FiveHour, sevenDay: 0.5 },
            { account: 2, fiveHour: 0, sevenDay: 0.5 },
            { account: 3, fiveHour: 0.2, sevenDay: 0.5 },
          ],
          2,
        ),
    },
    to(fiveHour) {
      return () => {
        account1FiveHour = fiveHour;
      };
    },
  };
}

describe("run's account lease", () => {
  it("never launches on an account a live holder has leased, taking the next one's lease", async () => {
    addSpec([1]);
    seedLease(1, true);
    const held: string[][] = [];
    const agentStep = FakeAgentStep.init(
      implemented("one.ts", { act: () => held.push(leaseFiles()) }),
      reviewed(),
    );

    const result = await specRun(agentStep).run(spec);

    expect(result.landed).toEqual([refOf(1)]);
    expect(accountsOf(agentStep)).toEqual([2, 2]);
    expect(held).toEqual([["account-1.lease", "account-2.lease"]]);
  });

  it("records its spec in the lease", async () => {
    addSpec([1]);
    const holders: LockHolder[] = [];
    const agentStep = FakeAgentStep.init(
      implemented("one.ts", {
        act: () => {
          holders.push(holderAt(leasePathOf(1)));
        },
      }),
      reviewed(),
    );

    await specRun(agentStep).run(spec);

    expect(holders.map((holder) => holder.spec)).toEqual([
      issueRef.labelOf(spec),
    ]);
  });

  it("records a Batch's label in its lease, as the Run board words it", async () => {
    const first = refOf(301);
    const second = refOf(302);
    addIssue(first.number);
    addIssue(second.number);
    const specs: (string | undefined)[] = [];
    function recordHolder(): void {
      specs.push(holderAt(leasePathOf(1)).spec);
    }
    const agentStep = FakeAgentStep.init(
      implemented("first.ts", { act: recordHolder }),
      reviewed(),
      implemented("second.ts", { act: recordHolder }),
      reviewed(),
    );
    const members: [typeof first, typeof second] = [first, second];

    await specRun(agentStep, { members }).run(...members);

    expect(specs).toEqual([
      "Batch byro-repo #301, #302",
      "Batch byro-repo #301, #302",
    ]);
  });

  it("names the account it holds in its status, not the Active account", async () => {
    addSpec([1]);
    const statuses: string[] = [];
    const run = specRun(
      FakeAgentStep.init(async (request) => {
        statuses.push(await run.status(spec));
        return implemented("one.ts")(request);
      }, reviewed()),
    );

    await run.run(spec);

    expect(statuses.map((status) => status.split("\n").at(-1))).toEqual([
      "Account: account 1: 5-hour 10%, weekly 20%.",
    ]);
  });

  it("names the account a Batch holds in its status", async () => {
    const first = refOf(301);
    const second = refOf(302);
    addIssue(first.number);
    addIssue(second.number);
    const statuses: string[] = [];
    const members: [typeof first, typeof second] = [first, second];
    const run = specRun(
      FakeAgentStep.init(
        async (request) => {
          statuses.push(await run.status(first));
          return implemented("first.ts")(request);
        },
        reviewed(),
        implemented("second.ts"),
        reviewed(),
      ),
      { members },
    );

    await run.run(...members);

    expect(statuses.map((status) => status.split("\n").at(-1))).toEqual([
      "Account: account 1: 5-hour 10%, weekly 20%.",
    ]);
  });

  it("takes over a lease a dead holder abandoned", async () => {
    addSpec([1]);
    seedLease(1, false);
    const agentStep = FakeAgentStep.init(implemented("one.ts"), reviewed());

    const result = await specRun(agentStep).run(spec);

    expect(result.landed).toEqual([refOf(1)]);
    expect(accountsOf(agentStep)).toEqual([1, 1]);
  });

  it("takes the new account's lease on a move before releasing the old one", async () => {
    addSpec([1]);
    const account1 = movingAccount1();
    const heldAtTake: boolean[] = [];
    const take = AccountLease.take.bind(AccountLease);
    vi.spyOn(AccountLease, "take").mockImplementation((folder, account) => {
      heldAtTake.push(existsSync(leasePathOf(1)));
      return take(folder, account);
    });
    const held: string[][] = [];
    const agentStep = FakeAgentStep.init(
      implemented("one.ts", { act: account1.to(0.95) }),
      async () => {
        held.push(leaseFiles());
        return reviewed();
      },
    );

    try {
      await specRun(agentStep, { usageReader: account1.usageReader }).run(spec);
    } finally {
      vi.restoreAllMocks();
    }

    expect(accountsOf(agentStep)).toEqual([1, 3]);
    expect(heldAtTake).toEqual([false, true]);
    expect(held).toEqual([["account-3.lease"]]);
  });

  it("waits while every account is leased by another run, saying so, and launches once one is released", async () => {
    addSpec([1]);
    seedLease(1, true);
    seedLease(2, true);
    const agentStep = FakeAgentStep.init(implemented("one.ts"), reviewed());

    const result = await specRun(agentStep, {
      async sleep() {
        rmSync(leasePathOf(1));
      },
    }).run(spec);

    expect(result.landed).toEqual([refOf(1)]);
    expect(accountsOf(agentStep)).toEqual([1, 1]);
    expect(noticeSummaries()[0]).toBe(
      "Run started on 1 tickets, waiting for a free account. Launching byro-repo #1.",
    );
    expect(noticeSummaries()).toContain(
      "Limit wait: every account is leased by another run; continuing once an account reads under its thresholds. An account another run releases continues the run too.",
    );
  });

  it("waits on the account past a threshold when the others are leased", async () => {
    addSpec([1]);
    seedLease(2, true);
    scriptUsage(
      usageListOf(0.1, 0.5),
      usageListOf(0.95, 0.5),
      usageListOf(0.1, 0.5),
    );
    const agentStep = FakeAgentStep.init(implemented("one.ts"), reviewed());

    const result = await specRun(agentStep, { async sleep() {} }).run(spec);

    expect(result.landed).toEqual([refOf(1)]);
    expect(noticeSummaries()).toContain(
      "Limit wait: account 1 is at 95% of its 5-hour limit; continuing after 2026-10-12 06:01:00 CDT. An account another run releases continues the run too.",
    );
  });

  it("holds no lease once the run finishes", async () => {
    addSpec([1]);

    await specRun(FakeAgentStep.init(implemented("one.ts"), reviewed())).run(
      spec,
    );

    expect(leaseFiles()).toEqual([]);
  });

  it("holds no lease once the run Stops", async () => {
    addSpec([1]);
    // The Active account goes unreadable once the implement step runs, so the review step's launch check Stops the run.
    let activeAccount: number | undefined = 2;
    const agentStep = FakeAgentStep.init(
      implemented("one.ts", {
        act: () => {
          activeAccount = undefined;
        },
      }),
      reviewed(),
    );

    const result = await specRun(agentStep, {
      usageReader: {
        read: async () => ({ ...usageListOf(0.1, 0.5), activeAccount }),
      },
    }).run(spec);

    expect(result.kind).toBe("stopped");
    expect(accountsOf(agentStep)).toEqual([1]);
    expect(leaseFiles()).toEqual([]);
  });

  it("holds no lease once the run is stopped on request", async () => {
    addSpec([1, 2]);
    const agentStep = FakeAgentStep.init(
      implemented("one.ts", { act: () => run.requestStop(spec) }),
      reviewed(),
    );
    const run = specRun(agentStep);

    const result = await run.run(spec);

    expect(result.kind).toBe("stopped");
    expect(leaseFiles()).toEqual([]);
  });

  it("holds one lease across a Batch's members", async () => {
    const first = refOf(301);
    const second = refOf(302);
    addIssue(first.number);
    addIssue(second.number);
    const held: string[][] = [];
    const agentStep = FakeAgentStep.init(
      implemented("first.ts", { act: () => held.push(leaseFiles()) }),
      reviewed(),
      implemented("second.ts", { act: () => held.push(leaseFiles()) }),
      reviewed(),
    );
    const members: [typeof first, typeof second] = [first, second];

    const result = await specRun(agentStep, { members }).run(...members);

    expect(result.landed).toEqual([first, second]);
    expect(accountsOf(agentStep)).toEqual([1, 1, 1, 1]);
    expect(held).toEqual([["account-1.lease"], ["account-1.lease"]]);
    expect(leaseFiles()).toEqual([]);
  });

  it("releases its lease while Idle, and returns to its last account once it is free, though another now ranks higher", async () => {
    addSpec([1]);
    const gated: Blocker = {
      kind: "gated-action",
      detail: "It needs app:build.",
      recommendation: "Run it by hand.",
    };
    const account1 = movingAccount1();
    const heldWhileIdle: string[][] = [];
    const agentStep = FakeAgentStep.init(
      async (request) => {
        account1.to(0.5)();
        return blocked([gated])(request);
      },
      implemented("one.ts"),
      reviewed(),
    );

    const result = await specRun(agentStep, {
      usageReader: account1.usageReader,
      async sleep() {
        heldWhileIdle.push(leaseFiles());
        github.reply(213, "H1: I ran it.");
      },
    }).run(spec);

    expect(result.landed).toEqual([refOf(1)]);
    expect(heldWhileIdle).toEqual([[]]);
    expect(accountsOf(agentStep)).toEqual([1, 1, 1]);
  });
});
