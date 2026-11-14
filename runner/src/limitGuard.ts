// The limit guard: from the usage reading of the account a step will run on, decides whether it runs now.
// readCswapList turns `cswap list --json` into readings and the active account; decideStep is the pure decision over one account's usage,
// and freshestUsageOf raises cswap's reading to a step stream's newer one.
// AgentStep.ts owns UsageWindow, the same shape a step's own rate-limit events report.

import type { UsageReading, UsageWindow } from "./AgentStep.ts";
import type { RunKnobs } from "./runKnobs.ts";
import { percentOf } from "./transcriptFacts.ts";

export type LimitGuardKnobs = Pick<
  RunKnobs,
  "fiveHourPauseAt" | "weeklyPauseAt" | "limitWaitMarginMs"
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

// For one account: launch, or a Limit wait until the reset of the window past its line plus the margin.
export type GuardDecision =
  | { kind: "launch" }
  | {
      kind: "limitWait";
      window: keyof AccountUsage;
      utilization: number;
      until: Date;
    };

// A stream gives resetsAt in whole seconds and cswap to the microsecond, so one window's two readings differ by under a second.
const sameWindowToleranceMs = 60_000;

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

// The runner never ends a step at a usage line: a step it cut off would resume only after its limit wait, which can outlast the prompt cache, so it interrupts a step only when a limit already has.
export function decideStep(
  usage: AccountUsage,
  knobs: LimitGuardKnobs,
): GuardDecision {
  if (usage.sevenDay.utilization >= knobs.weeklyPauseAt) {
    return limitWaitOf(usage, "sevenDay", knobs);
  }
  if (usage.fiveHour.utilization >= knobs.fiveHourPauseAt) {
    return limitWaitOf(usage, "fiveHour", knobs);
  }
  return { kind: "launch" };
}

function limitWaitOf(
  usage: AccountUsage,
  window: keyof AccountUsage,
  knobs: LimitGuardKnobs,
): GuardDecision {
  const { utilization, resetsAt } = usage[window];
  const until = new Date(resetsAt.getTime() + knobs.limitWaitMarginMs);
  return { kind: "limitWait", window, utilization, until };
}

// cswap's reading lags a step's own stream, so each window takes the higher, the stream's only while it is of the same window.
export function freshestUsageOf(
  cswap: AccountUsage,
  stream: UsageReading | undefined,
): AccountUsage {
  return {
    fiveHour: freshestWindowOf(cswap.fiveHour, stream?.fiveHour),
    sevenDay: freshestWindowOf(cswap.sevenDay, stream?.sevenDay),
  };
}

function freshestWindowOf(
  cswap: UsageWindow,
  stream: UsageWindow | undefined,
): UsageWindow {
  if (stream === undefined) return cswap;
  const gapMs = Math.abs(stream.resetsAt.getTime() - cswap.resetsAt.getTime());
  if (gapMs >= sameWindowToleranceMs) return cswap;
  if (stream.utilization <= cswap.utilization) return cswap;
  return { ...cswap, utilization: stream.utilization };
}

// Words a decision's window as the guard's notices name it.
export function windowNameOf(window: keyof AccountUsage): string {
  return window === "fiveHour" ? "5-hour" : "weekly";
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
