// The limit guard: from the usage reading of the account a step will run on, decides whether it runs now.
// readCswapList turns `cswap list --json` into readings and the active account; decideStep is the pure decision over one account's usage.
// AgentStep.ts owns UsageWindow, the same shape a step's own rate-limit events report.

import type { UsageReading, UsageWindow } from "./AgentStep.ts";
import type { RunKnobs } from "./runKnobs.ts";
import { percentOf } from "./transcriptFacts.ts";

export type LimitGuardKnobs = Pick<
  RunKnobs,
  "fiveHourPauseAt" | "weeklyReserveAt" | "limitWaitMarginMs"
>;

export interface AccountUsage {
  fiveHour: UsageWindow;
  sevenDay: UsageWindow;
}

// `usage` is undefined when cswap gave no usable reading for the account.
export interface AccountReading {
  account: number;
  usage: AccountUsage | undefined;
}

// `activeAccount` is undefined when cswap reported no usable active account; it is never guessed.
export interface UsageList {
  readings: AccountReading[];
  activeAccount: number | undefined;
}

export interface UsageReader {
  read(): Promise<UsageList>;
}

// For one account: launch, a Limit wait until its 5-hour reset plus the margin, or a Stop past its weekly reserve.
export type GuardDecision =
  { kind: "launch" } | { kind: "limitWait"; until: Date } | { kind: "stop" };

interface RawList {
  activeAccountNumber?: unknown;
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

export function readCswapList(json: string): UsageList {
  let list: RawList | undefined;
  try {
    list = JSON.parse(json) as RawList | undefined;
  } catch {
    return { readings: [], activeAccount: undefined };
  }
  return {
    readings: readingsOf(list?.accounts),
    activeAccount: activeAccountOf(list?.activeAccountNumber),
  };
}

function readingsOf(accounts: unknown): AccountReading[] {
  if (!Array.isArray(accounts)) return [];
  return (accounts as (RawAccount | undefined)[]).flatMap((raw) => {
    if (typeof raw?.number !== "number") return [];
    return [{ account: raw.number, usage: usageOf(raw) }];
  });
}

function activeAccountOf(raw: unknown): number | undefined {
  if (typeof raw !== "number" || !Number.isInteger(raw) || raw < 1) {
    return undefined;
  }
  return raw;
}

function usageOf(raw: RawAccount): AccountUsage | undefined {
  const fiveHour = windowOf(raw.usage?.fiveHour);
  const sevenDay = windowOf(raw.usage?.sevenDay);
  if (!fiveHour || !sevenDay) return undefined;
  return { fiveHour, sevenDay };
}

function windowOf(raw: RawWindow | undefined): UsageWindow | undefined {
  if (typeof raw?.pct !== "number") return undefined;
  // cswap omits resetsAt for a window that hasn't started; it has nothing to wait for.
  if (raw.pct === 0 && raw.resetsAt === undefined) {
    return { utilization: 0, resetsAt: new Date(0) };
  }
  if (typeof raw.resetsAt !== "string") return undefined;
  const resetsAt = new Date(raw.resetsAt);
  if (Number.isNaN(resetsAt.getTime())) return undefined;
  return { utilization: raw.pct / 100, resetsAt };
}

export function decideStep(
  usage: AccountUsage,
  knobs: LimitGuardKnobs,
): GuardDecision {
  if (usage.sevenDay.utilization >= knobs.weeklyReserveAt) {
    return { kind: "stop" };
  }
  if (usage.fiveHour.utilization >= knobs.fiveHourPauseAt) {
    const until = usage.fiveHour.resetsAt.getTime() + knobs.limitWaitMarginMs;
    return { kind: "limitWait", until: new Date(until) };
  }
  return { kind: "launch" };
}

// A step's own stream may lack a window that cswap always reports, so either may be unknown.
export function readingLabelOf(
  account: number,
  usage: UsageReading | undefined,
): string {
  if (usage === undefined) return `account ${account}: no usage reading`;
  return `account ${account}: 5-hour ${windowLabelOf(usage.fiveHour)}, weekly ${windowLabelOf(usage.sevenDay)}`;
}

function windowLabelOf(window: UsageWindow | undefined): string {
  if (window === undefined) return "unknown";
  return percentOf(window.utilization);
}
