import { describe, expect, it } from "vitest";

import {
  type AccountReading,
  decideStep,
  defaultLimitGuardKnobs,
  type GuardState,
  readCswapList,
} from "./limitGuard.ts";

const fiveHourReset = new Date("2026-10-12T05:00:00Z");

interface ReadingSpec {
  account: number;
  fiveHour: number;
  sevenDay: number;
  resetsAt?: Date;
}

function reading({
  account,
  fiveHour,
  sevenDay,
  resetsAt = fiveHourReset,
}: ReadingSpec): AccountReading {
  return {
    account,
    usage: {
      fiveHour: { utilization: fiveHour, resetsAt },
      sevenDay: {
        utilization: sevenDay,
        resetsAt: new Date("2026-10-14T00:00:00Z"),
      },
    },
  };
}

const runStart: GuardState = {
  pinnedAccount: undefined,
  isAtTicketBoundary: true,
  accountChangesToday: 0,
};

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
    const readings = readCswapList(json);
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

  it("returns no readings for unparseable output rather than throwing", () => {
    expect(readCswapList("cswap: not logged in")).toEqual([]);
    expect(readCswapList("null")).toEqual([]);
  });
});

describe("decideStep", () => {
  it("starts on the lowest weekly usage under both thresholds, ignoring the active account", () => {
    const readings = [
      reading({ account: 1, fiveHour: 0.1, sevenDay: 0.3 }),
      reading({ account: 2, fiveHour: 0.95, sevenDay: 0.1 }),
      reading({ account: 3, fiveHour: 0.2, sevenDay: 0.4 }),
    ];
    expect(decideStep(readings, runStart)).toEqual({
      kind: "launch",
      account: 1,
    });
  });

  it("keeps the pinned account mid-ticket even past a threshold", () => {
    const readings = [
      reading({ account: 1, fiveHour: 0.99, sevenDay: 0.99 }),
      reading({ account: 2, fiveHour: 0, sevenDay: 0 }),
    ];
    const midTicket = {
      pinnedAccount: 1,
      isAtTicketBoundary: false,
      accountChangesToday: 0,
    };
    expect(decideStep(readings, midTicket)).toEqual({
      kind: "launch",
      account: 1,
    });
  });

  it("keeps the pinned account at a boundary while it is under both thresholds", () => {
    const readings = [
      reading({ account: 1, fiveHour: 0.5, sevenDay: 0.6 }),
      reading({ account: 2, fiveHour: 0, sevenDay: 0 }),
    ];
    const boundary = {
      pinnedAccount: 1,
      isAtTicketBoundary: true,
      accountChangesToday: 0,
    };
    expect(decideStep(readings, boundary)).toEqual({
      kind: "launch",
      account: 1,
    });
  });

  it("changes account at a boundary and reports the soft cap as over, never waiting", () => {
    const readings = [
      reading({ account: 1, fiveHour: 0.91, sevenDay: 0.5 }),
      reading({ account: 2, fiveHour: 0.1, sevenDay: 0.7 }),
      reading({ account: 3, fiveHour: 0.1, sevenDay: 0.6 }),
    ];
    const boundary = {
      pinnedAccount: 1,
      isAtTicketBoundary: true,
      accountChangesToday: 2,
    };
    expect(decideStep(readings, boundary)).toEqual({
      kind: "changeAccount",
      from: 1,
      to: 3,
      accountChangesToday: 3,
      isOverSoftCap: true,
    });
  });

  it("waits until the earliest 5-hour reset plus the margin when every account is over 5-hour", () => {
    const readings = [
      reading({
        account: 1,
        fiveHour: 0.95,
        sevenDay: 0.5,
        resetsAt: new Date("2026-10-12T06:00:00Z"),
      }),
      reading({
        account: 2,
        fiveHour: 0.9,
        sevenDay: 0.5,
        resetsAt: new Date("2026-10-12T04:00:00Z"),
      }),
      reading({
        account: 3,
        fiveHour: 0.92,
        sevenDay: 0.97,
        resetsAt: new Date("2026-10-12T03:00:00Z"),
      }),
    ];
    const knobs = { ...defaultLimitGuardKnobs, limitWaitMarginMs: 60_000 };
    expect(decideStep(readings, runStart, knobs)).toEqual({
      kind: "limitWait",
      until: new Date("2026-10-12T04:01:00Z"),
    });
  });

  it("stops when every account is past its weekly reserve", () => {
    const readings = [
      reading({ account: 1, fiveHour: 0, sevenDay: 0.95 }),
      reading({ account: 2, fiveHour: 0, sevenDay: 0.99 }),
    ];
    expect(decideStep(readings, runStart)).toEqual({
      kind: "stop",
      reason: "every account is past its weekly reserve",
    });
  });

  it("skips accounts with a missing reading", () => {
    const readings = [
      { account: 1, usage: undefined },
      reading({ account: 2, fiveHour: 0.5, sevenDay: 0.5 }),
    ];
    expect(decideStep(readings, runStart)).toEqual({
      kind: "launch",
      account: 2,
    });
    expect(decideStep([{ account: 1, usage: undefined }], runStart)).toEqual({
      kind: "stop",
      reason: "no account has a usage reading",
    });
  });
});
