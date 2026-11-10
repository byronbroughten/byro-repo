import { describe, expect, it } from "vitest";

import type { UsageReading } from "./AgentStep.ts";
import {
  type AccountUsage,
  decideStep,
  freshestUsageOf,
  readCswapList,
} from "./limitGuard.ts";
import { defaultRunKnobs } from "./runKnobs.ts";

const fiveHourReset = new Date("2026-10-12T05:00:00Z");

function usageOf(fiveHour: number, sevenDay: number): AccountUsage {
  return {
    fiveHour: { utilization: fiveHour, resetsAt: fiveHourReset },
    sevenDay: {
      utilization: sevenDay,
      resetsAt: new Date("2026-10-14T00:00:00Z"),
    },
  };
}

describe("readCswapList", () => {
  it("reads each account's percents as fractions and its reset times", () => {
    const json = JSON.stringify({
      activeAccountNumber: 1,
      accounts: [
        {
          number: 1,
          usage: {
            fiveHour: {
              pct: 68.0,
              resetsAt: "2026-10-12T02:49:59.770554+00:00",
            },
            sevenDay: {
              pct: 76.0,
              resetsAt: "2026-10-14T11:59:59.770572+00:00",
            },
          },
        },
        { number: 2, usageStatus: "error" },
        {
          number: 3,
          usage: {
            fiveHour: { pct: 1, resetsAt: "not a date" },
            sevenDay: { pct: 1, resetsAt: "2026-10-14T00:00:00Z" },
          },
        },
      ],
    });
    const { readings, activeAccount } = readCswapList(json);
    expect(activeAccount).toBe(1);
    expect(readings[0]).toEqual({
      account: 1,
      usage: {
        fiveHour: {
          utilization: 0.68,
          resetsAt: new Date("2026-10-12T02:49:59.770Z"),
        },
        sevenDay: {
          utilization: 0.76,
          resetsAt: new Date("2026-10-14T11:59:59.770Z"),
        },
      },
    });
    expect(readings.slice(1)).toEqual([
      { account: 2, usage: undefined },
      { account: 3, usage: undefined },
    ]);
  });

  it("reads a window cswap gives no reset time because it hasn't started as unused", () => {
    const json = JSON.stringify({
      accounts: [
        {
          number: 2,
          usage: {
            fiveHour: { pct: 0.0 },
            sevenDay: { pct: 5.0, resetsAt: "2026-10-20T14:59:59Z" },
          },
        },
      ],
    });
    expect(readCswapList(json).readings).toEqual([
      {
        account: 2,
        usage: {
          fiveHour: { utilization: 0, resetsAt: new Date(0) },
          sevenDay: {
            utilization: 0.05,
            resetsAt: new Date("2026-10-20T14:59:59Z"),
          },
        },
      },
    ]);
  });

  it("reads a missing active account as unknown, keeping the readings", () => {
    const json = JSON.stringify({ accounts: [{ number: 2 }] });
    expect(readCswapList(json)).toEqual({
      readings: [{ account: 2, usage: undefined }],
      activeAccount: undefined,
    });
  });

  it.each([["2"], [null], [1.5], [0], [-1], [Number.NaN], [{ number: 2 }]])(
    "reads a malformed active account %j as unknown rather than guessing",
    (activeAccountNumber) => {
      const json = JSON.stringify({ activeAccountNumber, accounts: [] });
      expect(readCswapList(json).activeAccount).toBeUndefined();
    },
  );

  it("returns no readings and an unknown active account for unparseable output rather than throwing", () => {
    const empty = { readings: [], activeAccount: undefined };
    expect(readCswapList("cswap: not logged in")).toEqual(empty);
    expect(readCswapList("null")).toEqual(empty);
  });
});

describe("decideStep", () => {
  it("launches an account under both thresholds", () => {
    expect(decideStep(usageOf(0.93, 0.99), defaultRunKnobs)).toEqual({
      kind: "launch",
    });
  });

  it("holds a step at 94% of the 5-hour window by default", () => {
    expect(decideStep(usageOf(0.94, 0.5), defaultRunKnobs).kind).toBe(
      "limitWait",
    );
  });

  it("pauses at an overridden 5-hour pause", () => {
    const knobs = { ...defaultRunKnobs, fiveHourPauseAt: 0.5 };
    expect(decideStep(usageOf(0.6, 0.1), knobs).kind).toBe("limitWait");
    expect(decideStep(usageOf(0.6, 0.1), defaultRunKnobs).kind).toBe("launch");
  });

  it("waits until the account's 5-hour reset plus the margin at the 5-hour pause", () => {
    const knobs = { ...defaultRunKnobs, limitWaitMarginMs: 60_000 };
    expect(decideStep(usageOf(0.95, 0.5), knobs)).toEqual({
      kind: "limitWait",
      window: "fiveHour",
      until: new Date("2026-10-12T05:01:00Z"),
    });
  });

  it("waits until the weekly reset plus the margin at the weekly line, even when the 5-hour window is also past its pause", () => {
    const weeklyWait = {
      kind: "limitWait",
      window: "sevenDay",
      until: new Date("2026-10-14T00:01:00Z"),
    };
    expect(decideStep(usageOf(0.1, 1), defaultRunKnobs)).toEqual(weeklyWait);
    expect(decideStep(usageOf(0.99, 1), defaultRunKnobs)).toEqual(weeklyWait);
  });
});

describe("freshestUsageOf", () => {
  function readingOf(fiveHour: number, resetsAt: Date): UsageReading {
    return {
      fiveHour: { utilization: fiveHour, resetsAt },
      sevenDay: undefined,
    };
  }

  it("takes the higher of cswap's reading and a step stream's in the same window", () => {
    const streamReset = new Date("2026-10-12T05:00:00.5Z");
    const freshest = freshestUsageOf(
      usageOf(0.9, 0.5),
      readingOf(0.95, streamReset),
    );
    expect(freshest.fiveHour.utilization).toBe(0.95);
    expect(freshest.sevenDay.utilization).toBe(0.5);
    expect(
      freshestUsageOf(usageOf(0.9, 0.5), readingOf(0.8, streamReset)).fiveHour
        .utilization,
    ).toBe(0.9);
  });

  it("ignores a step stream's reading from a window that has since reset", () => {
    const earlierWindow = readingOf(0.95, new Date("2026-10-12T00:00:00Z"));
    expect(freshestUsageOf(usageOf(0.1, 0.5), earlierWindow)).toEqual(
      usageOf(0.1, 0.5),
    );
  });

  it("keeps cswap's reading when no step stream gave one", () => {
    expect(freshestUsageOf(usageOf(0.3, 0.5), undefined)).toEqual(
      usageOf(0.3, 0.5),
    );
  });
});
