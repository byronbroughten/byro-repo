// The limit guard: from the usage reading of the account a step will run on, decides whether it runs now.
// readCswapList turns `cswap list --json` into readings and the active account; decideStep is the pure decision over one account's usage,
// rankAccounts orders every account for a switch, and freshestUsageOf raises cswap's reading to a step stream's newer one.
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
  isDisabled?: boolean; // Set only when `cswap disable` holds the account out of rotation.
}

// `activeAccount` is undefined when cswap reported no usable active account; it is never guessed.
export interface UsageList {
  readings: AccountReading[];
  activeAccount: number | undefined;
}

// A run reads its usage list as this, since it Stops on a list with no Active account.
export type KnownActiveUsageList = UsageList & { activeAccount: number };

// By account, the latest usage reading a step's own stream gave.
export type StreamUsage = ReadonlyMap<number, UsageReading>;

export interface UsageReader {
  read(): Promise<UsageList>;
}

export interface LimitWait {
  kind: "limitWait";
  window: keyof AccountUsage;
  utilization: number;
  until: Date;
}

// For one account: launch, or a Limit wait until the reset of the window past its line plus the margin.
export type GuardDecision = { kind: "launch" } | LimitWait;

// The streams' readings are the run's latest per account; the switch command has none.
export interface AccountRankRequest {
  usageList: UsageList;
  leasedAccounts: ReadonlySet<number>;
  unavailableAccounts: ReadonlySet<number>;
  streamUsage?: StreamUsage;
  knobs: LimitGuardKnobs;
  putActiveLast: boolean;
}

export type LeftOutReason =
  { kind: "disabled" | "unavailable" | "leased" } | LimitWait;

export interface LeftOutAccount {
  account: number;
  reason: LeftOutReason;
}

// `ranked` is best first, each with its freshest usage; one with none comes last, and the caller warns of it.
export interface AccountRanking {
  ranked: AccountReading[];
  leftOut: LeftOutAccount[];
}

// A stream gives resetsAt in whole seconds and cswap to the microsecond, so one window's two readings differ by under a second.
const sameWindowToleranceMs = 60_000;

interface RawList {
  activeAccountNumber?: unknown;
  accounts?: unknown;
}

interface RawAccount {
  number?: unknown;
  disabled?: unknown;
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
    const reading: AccountReading = {
      account: raw.number,
      usage: usageOf(raw),
    };
    // cswap writes `disabled` only on a disabled account's row.
    if (raw.disabled === true) reading.isDisabled = true;
    return [reading];
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

// The runner never ends a step at a usage line: a step it cut off would cost a resume, and with no other account free a limit wait that can outlast the prompt cache, so it interrupts a step only when a limit already has.
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
): LimitWait {
  const { utilization, resetsAt } = usage[window];
  const until = new Date(resetsAt.getTime() + knobs.limitWaitMarginMs);
  return { kind: "limitWait", window, utilization, until };
}

// One ranking for `npm run account:switch` and a run's launch check, so both pick the same account.
export function rankAccounts(request: AccountRankRequest): AccountRanking {
  const { usageList, streamUsage, putActiveLast } = request;
  const ranking: AccountRanking = { ranked: [], leftOut: [] };
  for (const reading of usageList.readings) {
    const fresh = freshReadingOf(reading, streamUsage);
    const reason = leftOutReasonOf(fresh, request);
    if (reason === undefined) {
      ranking.ranked.push(fresh);
    } else {
      ranking.leftOut.push({ account: fresh.account, reason });
    }
  }
  const lastAccount = putActiveLast ? usageList.activeAccount : undefined;
  ranking.ranked.sort((a, b) => compareReadings(a, b, lastAccount));
  return ranking;
}

export function freshReadingOf(
  reading: AccountReading,
  streamUsage: StreamUsage | undefined,
): AccountReading {
  if (reading.usage === undefined) return reading;
  const stream = streamUsage?.get(reading.account);
  return { ...reading, usage: freshestUsageOf(reading.usage, stream) };
}

function leftOutReasonOf(
  reading: AccountReading,
  { leasedAccounts, unavailableAccounts, knobs }: AccountRankRequest,
): LeftOutReason | undefined {
  const { account, isDisabled } = reading;
  if (isDisabled === true) return { kind: "disabled" };
  if (unavailableAccounts.has(account)) return { kind: "unavailable" };
  if (leasedAccounts.has(account)) return { kind: "leased" };
  const decision = decideReading(reading, knobs);
  return decision?.kind === "limitWait" ? decision : undefined;
}

// Undefined for an account with no usable reading, which no threshold holds.
export function decideReading(
  { usage }: AccountReading,
  knobs: LimitGuardKnobs,
): GuardDecision | undefined {
  if (usage === undefined) return undefined;
  return decideStep(usage, knobs);
}

// Each comparison's 0 is a tie that falls through to the next.
function compareReadings(
  a: AccountReading,
  b: AccountReading,
  lastAccount: number | undefined,
): number {
  return (
    compareFlags(a.usage === undefined, b.usage === undefined) ||
    compareFlags(a.account === lastAccount, b.account === lastAccount) ||
    compareUsage(a.usage, b.usage) ||
    a.account - b.account
  );
}

function compareFlags(a: boolean, b: boolean): number {
  return Number(a) - Number(b);
}

function compareUsage(
  a: AccountUsage | undefined,
  b: AccountUsage | undefined,
): number {
  if (a === undefined || b === undefined) return 0;
  return (
    compareFlags(
      isUnstartedWindow(a.sevenDay),
      isUnstartedWindow(b.sevenDay),
    ) ||
    a.sevenDay.resetsAt.getTime() - b.sevenDay.resetsAt.getTime() ||
    a.fiveHour.utilization - b.fiveHour.utilization
  );
}

// readCswapList reads a window cswap gives no reset time as resetting at the epoch.
export function isUnstartedWindow(window: UsageWindow): boolean {
  return window.resetsAt.getTime() === 0;
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
