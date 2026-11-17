import { describe, expect, it } from "vitest";

import type { LeasedAccount } from "./AccountLease.ts";
import { accountSwitch, type AccountSwitchPort } from "./accountSwitch.ts";
import { FakeUsageReader } from "./FakeUsageReader.ts";
import type { AccountReading, UsageList } from "./limitGuard.ts";
import { localTimeOf } from "./localTime.ts";
import { defaultRunKnobs } from "./runKnobs.ts";

const soonReset = new Date("2026-10-13T00:00:00Z");
const lateReset = new Date("2026-10-15T00:00:00Z");
const fiveHourReset = new Date("2026-10-12T05:00:00Z");
const holderStart = "2026-10-12T01:00:00Z";
const now = new Date("2026-10-12T00:00:00Z");

function readingOf(
  account: number,
  fiveHour: number,
  weeklyReset: Date,
): AccountReading {
  return {
    account,
    usage: {
      fiveHour: { utilization: fiveHour, resetsAt: fiveHourReset },
      sevenDay: { utilization: 0.5, resetsAt: weeklyReset },
    },
  };
}

class FakeSwitchPort implements AccountSwitchPort {
  readonly switched: number[] = [];

  async switchTo(account: number): Promise<void> {
    this.switched.push(account);
  }
}

interface SwitchScript {
  lists: UsageList[];
  leased?: LeasedAccount[];
}

async function switchWith({ lists, leased = [] }: SwitchScript) {
  const lines: string[] = [];
  const switchPort = new FakeSwitchPort();
  const switchedTo = await accountSwitch.run({
    usageReader: FakeUsageReader.init(...lists),
    leaseReader: { read: () => leased },
    switchPort,
    // Pinned, so tuning a default can't move a test's past-the-threshold reading under it.
    knobs: { ...defaultRunKnobs, fiveHourPauseAt: 0.94, weeklyPauseAt: 1 },
    now: () => now,
    print: (line) => lines.push(line),
  });
  return { lines, switched: switchPort.switched, switchedTo };
}

describe("accountSwitch.run", () => {
  it("switches to the free account with the soonest weekly reset, printing the readings before and after", async () => {
    const readings = [
      readingOf(1, 0.2, lateReset),
      readingOf(2, 0.3, soonReset),
    ];
    const { lines, switched, switchedTo } = await switchWith({
      lists: [
        { readings, activeAccount: 1 },
        { readings, activeAccount: 2 },
      ],
    });

    expect(switched).toEqual([2]);
    expect(switchedTo).toBe(2);
    expect(lines).toEqual([
      "Before:",
      "  1. (active) 5h: 20% (5h 0m), 7d: 50% (3d 0h)",
      "  2. 5h: 30% (5h 0m), 7d: 50% (1d 0h)",
      "Switching to account 2, the best free account.",
      "After:",
      "  1. 5h: 20% (5h 0m), 7d: 50% (3d 0h)",
      "  2. (active) 5h: 30% (5h 0m), 7d: 50% (1d 0h)",
    ]);
  });

  it("passes over a leased account, naming its holder", async () => {
    const readings = [
      readingOf(1, 0.2, lateReset),
      readingOf(2, 0.3, soonReset),
      readingOf(3, 0.3, lateReset),
    ];
    const { lines, switched } = await switchWith({
      lists: [{ readings, activeAccount: 3 }],
      leased: [
        {
          account: 2,
          holder: { pid: 41, host: "here", startedAt: holderStart, token: "t" },
        },
      ],
    });

    expect(switched).toEqual([1]);
    expect(lines[2]).toBe(
      `  2. 5h: 30% (5h 0m), 7d: 50% (1d 0h), held by pid 41 since ${localTimeOf(new Date(holderStart))}`,
    );
  });

  it("switches nothing when the Active account already ranks best, saying so", async () => {
    const readings = [
      readingOf(1, 0.2, soonReset),
      readingOf(2, 0.3, lateReset),
    ];
    const { lines, switched, switchedTo } = await switchWith({
      lists: [{ readings, activeAccount: 1 }],
    });

    expect(switched).toEqual([]);
    expect(switchedTo).toBeUndefined();
    expect(lines.at(-1)).toBe(
      "Account 1, the Active account, already ranks best; switching nothing.",
    );
    expect(lines).not.toContain("After:");
  });

  it("switches nothing when no account is free, naming each one's holder or the threshold it is past", async () => {
    const readings: AccountReading[] = [
      readingOf(1, 0.95, soonReset),
      readingOf(2, 0.3, lateReset),
      { ...readingOf(3, 0.1, lateReset), isDisabled: true },
      { account: 4, usage: undefined },
    ];
    const { lines, switched } = await switchWith({
      lists: [{ readings, activeAccount: 1 }],
      leased: [
        { account: 2, holder: undefined },
        { account: 4, holder: undefined },
      ],
    });

    expect(switched).toEqual([]);
    expect(lines.slice(-5)).toEqual([
      "No account is free; switching nothing. Choose one with `cswap switch <n>`:",
      "  account 1: past its 5-hour threshold at 95%",
      "  account 2: held by an unreadable lease",
      "  account 3: disabled in cswap",
      "  account 4: held by an unreadable lease",
    ]);
  });

  it("warns that an account it would switch to has no usage reading", async () => {
    const { lines, switched } = await switchWith({
      lists: [
        {
          readings: [
            readingOf(1, 0.95, soonReset),
            { account: 2, usage: undefined },
          ],
          activeAccount: 1,
        },
      ],
    });

    expect(switched).toEqual([2]);
    expect(lines).toContain(
      "Warning: account 2 has no usage reading, so it ranks last.",
    );
  });
});
