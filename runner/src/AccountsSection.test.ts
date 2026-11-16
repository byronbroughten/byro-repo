import { describe, expect, it } from "vitest";

import type { LeasedAccount } from "./AccountLease.ts";
import { AccountsSection } from "./AccountsSection.ts";
import type { UsageReading, UsageWindow } from "./AgentStep.ts";
import { FakeUsageReader } from "./FakeUsageReader.ts";
import type { AccountReading, UsageList } from "./limitGuard.ts";
import { localTimeOf } from "./localTime.ts";

const now = new Date("2026-10-12T00:00:00.000Z");
const holderStart = "2026-10-11T22:00:00.000Z";
const durationMs = {
  minute: 60_000,
  hour: 3_600_000,
  day: 86_400_000,
} as const;

function windowOf(percent: number, resetInMs: number): UsageWindow {
  return {
    utilization: percent / 100,
    resetsAt: new Date(now.getTime() + resetInMs),
  };
}

const unstarted: UsageWindow = { utilization: 0, resetsAt: new Date(0) };

function readingOf(
  account: number,
  fiveHour: UsageWindow,
  sevenDay: UsageWindow,
): AccountReading {
  return { account, usage: { fiveHour, sevenDay } };
}

const threeAccounts: UsageList = {
  readings: [
    readingOf(
      1,
      windowOf(100, 3 * durationMs.hour + 19 * durationMs.minute),
      windowOf(10, 5 * durationMs.day + 4 * durationMs.hour),
    ),
    readingOf(
      2,
      unstarted,
      windowOf(
        10,
        durationMs.day + 5 * durationMs.hour + 30 * durationMs.minute,
      ),
    ),
    readingOf(
      3,
      windowOf(70, 2 * durationMs.hour + durationMs.minute),
      windowOf(22, 6 * durationMs.day + durationMs.hour),
    ),
  ],
  activeAccount: 1,
};

const heldThree: LeasedAccount[] = [
  {
    account: 3,
    holder: { pid: 41, host: "here", startedAt: holderStart, token: "t" },
  },
];

const heldThreeLabel = `held by pid 41 since ${localTimeOf(new Date(holderStart))}`;

interface SectionScript {
  lists: (UsageList | Error)[];
  leased?: LeasedAccount[];
  refreshMs?: number;
}

function sectionWith({ lists, leased = [], refreshMs }: SectionScript) {
  const usageReader = FakeUsageReader.init(...lists);
  const section = AccountsSection.init({
    usageReader,
    leaseReader: { read: () => leased },
    refreshMs,
  });
  return { section, usageReader };
}

function later(ms: number): Date {
  return new Date(now.getTime() + ms);
}

describe("AccountsSection.textAt", () => {
  it("lists each account's line by account number, marking the Active account and a leased account's holder", async () => {
    const { section } = sectionWith({
      lists: [threeAccounts],
      leased: heldThree,
    });

    expect(await section.textAt(now)).toBe(
      [
        "Accounts",
        "  1. (active) 5h: 100% (3h 19m), 7d: 10% (5d 4h)",
        "  2. 5h: 0%, 7d: 10% (1d 5h)",
        `  3. 5h: 70% (2h 1m), 7d: 22% (6d 1h), ${heldThreeLabel}`,
      ].join("\n"),
    );
  });

  it("reads an account with no usable reading as no reading, still with its holder, and a disabled one as disabled", async () => {
    const { section } = sectionWith({
      lists: [
        {
          readings: [
            { account: 1, usage: undefined },
            { account: 3, usage: undefined },
            {
              ...readingOf(4, unstarted, windowOf(10, durationMs.day)),
              isDisabled: true,
            },
          ],
          activeAccount: 1,
        },
      ],
      leased: [...heldThree, { account: 1, holder: undefined }],
    });

    expect(await section.textAt(now)).toBe(
      [
        "Accounts",
        "  1. (active) no reading, held by an unreadable lease",
        `  3. no reading, ${heldThreeLabel}`,
        "  4. disabled",
      ].join("\n"),
    );
  });

  it("takes a step's stream reading for a window only when it is higher and of the same window", async () => {
    const { section } = sectionWith({ lists: [threeAccounts] });
    const streamUsage = new Map<number, UsageReading>([
      [
        1,
        {
          fiveHour: windowOf(40, 3 * durationMs.hour + 19 * durationMs.minute),
          sevenDay: windowOf(15, 5 * durationMs.day + 4 * durationMs.hour),
        },
      ],
      [
        3,
        {
          fiveHour: windowOf(90, 7 * durationMs.hour),
          sevenDay: undefined,
        },
      ],
    ]);

    expect(await section.textAt(now, streamUsage)).toBe(
      [
        "Accounts",
        "  1. (active) 5h: 100% (3h 19m), 7d: 15% (5d 4h)",
        "  2. 5h: 0%, 7d: 10% (1d 5h)",
        "  3. 5h: 70% (2h 1m), 7d: 22% (6d 1h)",
      ].join("\n"),
    );
  });

  it("reads cswap once per refresh interval, heading the kept reading with its age in between", async () => {
    const secondList: UsageList = {
      ...threeAccounts,
      activeAccount: 2,
    };
    const { section, usageReader } = sectionWith({
      lists: [threeAccounts, secondList],
      refreshMs: 60_000,
    });

    const first = await section.textAt(now);
    const between = await section.textAt(later(40_000));
    const next = await section.textAt(later(60_000));

    expect(usageReader.readCount).toBe(2);
    expect(first.split("\n")[0]).toBe("Accounts");
    expect(between.split("\n").slice(0, 2)).toEqual([
      "Accounts (read 40s ago)",
      "  1. (active) 5h: 100% (3h 18m), 7d: 10% (5d 3h)",
    ]);
    expect(next.split("\n").slice(0, 3)).toEqual([
      "Accounts",
      "  1. 5h: 100% (3h 18m), 7d: 10% (5d 3h)",
      "  2. (active) 5h: 0%, 7d: 10% (1d 5h)",
    ]);
  });

  it("reads once and shows no age when built with no refresh interval", async () => {
    const { section, usageReader } = sectionWith({ lists: [threeAccounts] });

    await section.textAt(now);
    const reread = await section.textAt(later(5 * durationMs.minute));

    expect(usageReader.readCount).toBe(1);
    expect(reread.split("\n")[0]).toBe("Accounts");
  });

  it("shows one unreadable line on a failed read, until a later read succeeds", async () => {
    const { section } = sectionWith({
      lists: [new Error("cswap: command not found"), threeAccounts],
      refreshMs: 60_000,
    });

    const failed = await section.textAt(now);
    const stillFailed = await section.textAt(later(30_000));
    const recovered = await section.textAt(later(60_000));

    expect(failed).toBe(
      "Accounts: cswap unreadable (cswap: command not found)",
    );
    expect(stillFailed).toBe(failed);
    expect(recovered.split("\n")[0]).toBe("Accounts");
    expect(recovered.split("\n")).toHaveLength(4);
  });

  it("words a reset less than a minute away as 0h 0m, and one already past the same", async () => {
    const { section } = sectionWith({
      lists: [
        {
          readings: [
            readingOf(1, windowOf(50, 30_000), windowOf(10, -durationMs.hour)),
          ],
          activeAccount: 2,
        },
      ],
    });

    expect(await section.textAt(now)).toBe(
      ["Accounts", "  1. 5h: 50% (0h 0m), 7d: 10% (0h 0m)"].join("\n"),
    );
  });
});
