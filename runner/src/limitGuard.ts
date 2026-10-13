// The limit guard: from every account's usage reading, decides where (or whether) the next step runs.
// readCswapList turns `cswap list --json` into readings; decideStep is the pure decision over them.
// AgentStep.ts owns UsageWindow, the same shape a step's own rate-limit events report.

import type { UsageWindow } from "./AgentStep.ts";

export interface LimitGuardKnobs {
  fiveHourPauseAt: number; // A fraction of the window's limit, 0 to 1.
  weeklyReserveAt: number; // A fraction of the window's limit, 0 to 1.
  limitWaitMarginMs: number;
  maxAccountChangesPerDay: number;
}

export const defaultLimitGuardKnobs: LimitGuardKnobs = {
  fiveHourPauseAt: 0.9,
  weeklyReserveAt: 0.95,
  limitWaitMarginMs: 5 * 60_000,
  maxAccountChangesPerDay: 2,
};

export interface AccountUsage {
  fiveHour: UsageWindow;
  sevenDay: UsageWindow;
}

// `usage` is undefined when cswap gave no usable reading for the account.
export interface AccountReading {
  account: number;
  usage: AccountUsage | undefined;
}

export interface UsageReader {
  read(): Promise<AccountReading[]>;
}

type MeasuredReading = AccountReading & { usage: AccountUsage };

export interface GuardState {
  // The account the current ticket is pinned to; undefined at run start.
  pinnedAccount: number | undefined;
  isAtTicketBoundary: boolean;
  accountChangesToday: number;
}

export type GuardDecision =
  | { kind: "launch"; account: number }
  | {
      kind: "changeAccount";
      from: number;
      to: number;
      accountChangesToday: number;
      isOverSoftCap: boolean;
    }
  | { kind: "limitWait"; until: Date }
  | { kind: "stop"; reason: string };

interface RawList {
  accounts?: unknown;
}

interface RawAccount {
  number?: unknown;
  usage?: { fiveHour?: RawWindow; sevenDay?: RawWindow };
}

interface RawWindow {
  pct?: unknown;
  resetsAt?: unknown;
}

export function readCswapList(json: string): AccountReading[] {
  let list: RawList | undefined;
  try {
    list = JSON.parse(json) as RawList | undefined;
  } catch {
    return [];
  }
  if (!Array.isArray(list?.accounts)) return [];
  return (list.accounts as (RawAccount | undefined)[]).flatMap((raw) => {
    if (typeof raw?.number !== "number") return [];
    return [{ account: raw.number, usage: usageOf(raw) }];
  });
}

function usageOf(raw: RawAccount): AccountUsage | undefined {
  const fiveHour = windowOf(raw.usage?.fiveHour);
  const sevenDay = windowOf(raw.usage?.sevenDay);
  if (!fiveHour || !sevenDay) return undefined;
  return { fiveHour, sevenDay };
}

function windowOf(raw: RawWindow | undefined): UsageWindow | undefined {
  if (typeof raw?.pct !== "number" || typeof raw.resetsAt !== "string") {
    return undefined;
  }
  const resetsAt = new Date(raw.resetsAt);
  if (Number.isNaN(resetsAt.getTime())) return undefined;
  return { utilization: raw.pct / 100, resetsAt };
}

export function decideStep(
  readings: AccountReading[],
  state: GuardState,
  knobs: LimitGuardKnobs = defaultLimitGuardKnobs,
): GuardDecision {
  const pinned = state.pinnedAccount;
  const pinnedReading = readings.find((r) => r.account === pinned);
  // A failed read shouldn't spend an account change.
  const isPinnedKept =
    !state.isAtTicketBoundary ||
    !pinnedReading?.usage ||
    isUnderBothThresholds(pinnedReading, knobs);
  if (pinned !== undefined && isPinnedKept) {
    return { kind: "launch", account: pinned };
  }
  const best = accountWithLowestWeekly(
    readings.filter((r) => isUnderBothThresholds(r, knobs)),
  );
  if (best === undefined) return waitOrStop(readings, knobs);
  if (pinned === undefined) return { kind: "launch", account: best };
  const accountChangesToday = state.accountChangesToday + 1;
  return {
    kind: "changeAccount",
    from: pinned,
    to: best,
    accountChangesToday,
    isOverSoftCap: accountChangesToday > knobs.maxAccountChangesPerDay,
  };
}

function isUnderBothThresholds(
  reading: AccountReading | undefined,
  knobs: LimitGuardKnobs,
): reading is MeasuredReading {
  return (
    !!reading?.usage &&
    reading.usage.fiveHour.utilization < knobs.fiveHourPauseAt &&
    !isPastWeeklyReserve(reading.usage, knobs)
  );
}

function isPastWeeklyReserve(
  usage: AccountUsage,
  knobs: LimitGuardKnobs,
): boolean {
  return usage.sevenDay.utilization >= knobs.weeklyReserveAt;
}

function accountWithLowestWeekly(
  readings: MeasuredReading[],
): number | undefined {
  const sorted = [...readings].sort(
    (a, b) =>
      a.usage.sevenDay.utilization - b.usage.sevenDay.utilization ||
      a.account - b.account,
  );
  return sorted[0]?.account;
}

function waitOrStop(
  readings: AccountReading[],
  knobs: LimitGuardKnobs,
): GuardDecision {
  const fiveHourResets = readings.flatMap((r) => {
    if (!r.usage || isPastWeeklyReserve(r.usage, knobs)) {
      return [];
    }
    return [r.usage.fiveHour.resetsAt.getTime()];
  });
  if (fiveHourResets.length > 0) {
    const until = Math.min(...fiveHourResets) + knobs.limitWaitMarginMs;
    return { kind: "limitWait", until: new Date(until) };
  }
  if (readings.some((r) => r.usage)) {
    return { kind: "stop", reason: "every account is past its weekly reserve" };
  }
  return { kind: "stop", reason: "no account has a usage reading" };
}
