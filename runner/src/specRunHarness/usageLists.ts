// The usage lists SpecRun tests script for the launch check, each account on a reading the test sets, re-exported by ../specRunHarness.ts.

import type { UsageList } from "../limitGuard.ts";

// One account's reading as a test sets it; its 5-hour reset defaults to the harness's own.
export interface ScriptedReading {
  account: number;
  fiveHour: number;
  sevenDay: number;
  fiveHourResetsAt?: Date;
}

export const usageLists = {
  // Account 1, which runs launch on while it reads under its thresholds, carries the usage; account 2, idle, is the Active account by default, so the ranking takes it last.
  usageListOf(
    fiveHour: number,
    sevenDay: number,
    activeAccount: number | undefined = 2,
  ): UsageList {
    return usageLists.accountsListOf(
      [
        { account: 1, fiveHour, sevenDay },
        { account: 2, fiveHour: 0, sevenDay: 0 },
      ],
      activeAccount,
    );
  },

  // Both accounts on one reading, so a threshold holds the run whichever it is on; account 2 is the Active one.
  everyAccountListOf(fiveHour: number, sevenDay: number): UsageList {
    return usageLists.accountsListOf(
      [
        { account: 1, fiveHour, sevenDay },
        { account: 2, fiveHour, sevenDay },
      ],
      2,
    );
  },

  accountsListOf(
    scripted: ScriptedReading[],
    activeAccount: number | undefined,
  ): UsageList {
    const readings = scripted.map((reading) => ({
      account: reading.account,
      usage: {
        fiveHour: {
          utilization: reading.fiveHour,
          resetsAt:
            reading.fiveHourResetsAt ?? new Date("2026-10-12T11:00:00Z"),
        },
        sevenDay: {
          utilization: reading.sevenDay,
          resetsAt: new Date("2026-10-15T00:00:00Z"),
        },
      },
    }));
    return { readings, activeAccount };
  },
};
