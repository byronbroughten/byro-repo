// The outcome facts a wrap-up computes from transcripts instead of asking: pair, peak context, duration, API-equivalent
// cost, review cost, account and session ids, from the session ids and config folder the runner records.
// A fact is computed only when every transcript it reads is found; otherwise it stays undefined and is written `unrecorded`.
// Peak context is contextMeter.ts; the row format is outcomeLog.ts; WrapUp.ts merges these over the passed facts.
// Refresh the price table when a new model version ships (docs/agents/model-fit.md).

import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { ContextMeter } from "./contextMeter.ts";
import type { OutcomeFacts } from "./outcomeLog.ts";

export type StepAgent = "implement" | "review" | "resolve";

export interface StepSession {
  agent: StepAgent;
  sessionId: string;
}

// Run state and facts files saved before #364 name the resolve step `triage` or `fix`.
export type SavedStepAgent = StepAgent | "triage" | "fix";

export interface SavedStepSession extends Omit<StepSession, "agent"> {
  agent: SavedStepAgent;
}

export function savedStepOf<SV extends string>(
  step: SV | "triage" | "fix",
): SV | "resolve" {
  return step === "triage" || step === "fix" ? "resolve" : step;
}

export function savedStepSessionOf({
  agent,
  sessionId,
}: SavedStepSession): StepSession {
  return { agent: savedStepOf(agent), sessionId };
}

export interface TicketSessions {
  account: number;
  configFolder: string;
  steps: StepSession[];
}

export interface ModelPrice {
  // Dollars per million tokens; a 5-minute cache write is 1.25× input and a 1-hour write 2×.
  input: number;
  output: number;
  cacheRead: number;
}

// From the claude-api skill, cached 2026-10-06; keyed by model id without the `claude-` prefix or a date suffix.
export const modelPrices: Record<string, ModelPrice> = {
  "fable-5-1": { input: 10, output: 50, cacheRead: 0.25 },
  "fable-5": { input: 10, output: 50, cacheRead: 1 },
  "opus-5-5": { input: 4, output: 20, cacheRead: 0.2 },
  "opus-5": { input: 5, output: 25, cacheRead: 0.5 },
  "opus-4-8": { input: 5, output: 25, cacheRead: 0.5 },
  "opus-4-7": { input: 5, output: 25, cacheRead: 0.5 },
  "opus-4-6": { input: 5, output: 25, cacheRead: 0.5 },
  "sonnet-5-5": { input: 2, output: 10, cacheRead: 0.2 },
  "sonnet-5": { input: 2, output: 10, cacheRead: 0.2 },
  "sonnet-4-6": { input: 3, output: 15, cacheRead: 0.3 },
  "haiku-5-5": { input: 0.1, output: 0.5, cacheRead: 0.01 }, // Prompts up to 100K tokens.
  "haiku-4-5": { input: 1, output: 5, cacheRead: 0.1 },
};

interface TranscriptEntry {
  type?: unknown;
  isSidechain?: unknown;
  timestamp?: unknown;
  effort?: unknown;
  message?: {
    id?: unknown;
    model?: unknown;
    usage?: Usage;
  };
}

interface Usage {
  input_tokens?: unknown;
  output_tokens?: unknown;
  cache_read_input_tokens?: unknown;
  cache_creation_input_tokens?: unknown;
  cache_creation?: {
    ephemeral_5m_input_tokens?: unknown;
    ephemeral_1h_input_tokens?: unknown;
  };
}

interface CacheWrites {
  fiveMinute: number;
  oneHour: number;
}

interface Transcript {
  text: string;
  entries: TranscriptEntry[];
  subagents: TranscriptEntry[][];
}

const syntheticModel = "<synthetic>";
const handoffSessionLine = /^session: (\S+)$/;

export function transcriptFactsOf(
  sessions: TicketSessions,
  handoffSessionIds: string[],
): OutcomeFacts {
  const projectDirs = projectDirsOf(sessions.configFolder);
  const implementerIds = unique([
    ...handoffSessionIds,
    ...stepIdsOf(sessions, "implement"),
  ]);
  const sessionIds = unique([
    ...handoffSessionIds,
    ...sessions.steps.map(({ sessionId }) => sessionId),
  ]);
  // With no implementer recorded, its facts are unrecorded rather than zero.
  const implementers =
    implementerIds.length === 0
      ? undefined
      : transcriptsOf(projectDirs, implementerIds);
  const reviewIds = stepIdsOf(sessions, "review");
  // With no review recorded, review cost is unrecorded rather than zero.
  const reviewSteps =
    reviewIds.length === 0
      ? undefined
      : transcriptsOf(
          projectDirs,
          unique([...reviewIds, ...stepIdsOf(sessions, "resolve")]),
        );
  const allSessions = transcriptsOf(projectDirs, sessionIds);
  return {
    account: String(sessions.account),
    sessionIds,
    pair: factOf(implementers, pairOf),
    peakContext: factOf(implementers, peaksOf),
    durationMinutes: factOf(allSessions, durationMinutesOf),
    costUsd: factOf(implementers, costUsdOf),
    reviewCostUsd: factOf(reviewSteps, costUsdOf),
  };
}

// A handoff comment ends with a `session: <id>` line naming the session that wrote it.
export function handoffSessionIdOf(comment: string): string | undefined {
  const lastLine = comment
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line !== "")
    .at(-1);
  return lastLine?.match(handoffSessionLine)?.[1];
}

function projectDirsOf(configFolder: string): string[] {
  const projects = join(configFolder, "projects");
  if (!existsSync(projects)) return [];
  return readdirSync(projects).map((name) => join(projects, name));
}

// Undefined when any id's transcript is missing.
function transcriptsOf(
  projectDirs: string[],
  ids: string[],
): Transcript[] | undefined {
  const found = ids.flatMap((id) => {
    const transcript = transcriptOf(projectDirs, id);
    return transcript === undefined ? [] : [transcript];
  });
  return found.length === ids.length ? found : undefined;
}

function transcriptOf(
  projectDirs: string[],
  sessionId: string,
): Transcript | undefined {
  const dir = projectDirs.find((projectDir) =>
    existsSync(join(projectDir, `${sessionId}.jsonl`)),
  );
  if (dir === undefined) return undefined;
  const text = readFileSync(join(dir, `${sessionId}.jsonl`), "utf8");
  return {
    text,
    entries: entriesOf(text),
    subagents: subagentPathsOf(join(dir, sessionId, "subagents")).map((path) =>
      entriesOf(readFileSync(path, "utf8")),
    ),
  };
}

function subagentPathsOf(subagentDir: string): string[] {
  if (!existsSync(subagentDir)) return [];
  return readdirSync(subagentDir)
    .filter((name) => name.endsWith(".jsonl"))
    .map((name) => join(subagentDir, name));
}

function entriesOf(text: string): TranscriptEntry[] {
  return text.split("\n").flatMap((line) => {
    try {
      const entry: unknown = JSON.parse(line);
      return typeof entry === "object" && entry !== null
        ? [entry as TranscriptEntry]
        : [];
    } catch {
      return [];
    }
  });
}

function factOf<RV>(
  transcripts: Transcript[] | undefined,
  compute: (found: Transcript[]) => RV | undefined,
): RV | undefined {
  if (transcripts === undefined) return undefined;
  return compute(transcripts);
}

function stepIdsOf(sessions: TicketSessions, agent: StepAgent): string[] {
  return sessions.steps
    .filter((step) => step.agent === agent)
    .map(({ sessionId }) => sessionId);
}

function unique(ids: string[]): string[] {
  return [...new Set(ids)];
}

// The most common `<Family> <effort>` over the implementer's main-loop replies.
function pairOf(implementers: Transcript[]): string | undefined {
  const counts = implementers
    .flatMap(({ entries }) => entries.flatMap(entryPairOf))
    .reduce((tally, pair) => {
      tally.set(pair, (tally.get(pair) ?? 0) + 1);
      return tally;
    }, new Map<string, number>());
  return [...counts].sort(([, a], [, b]) => b - a)[0]?.[0];
}

// Empty for a subagent, synthetic or effortless entry.
function entryPairOf(entry: TranscriptEntry): string[] {
  if (entry.type !== "assistant" || entry.isSidechain === true) return [];
  const model = entry.message?.model;
  if (typeof model !== "string" || model === syntheticModel) return [];
  if (typeof entry.effort !== "string") return [];
  const family = priceKeyOf(model).split("-")[0] ?? "";
  return [
    `${family.charAt(0).toUpperCase()}${family.slice(1)} ${entry.effort}`,
  ];
}

function peaksOf(implementers: Transcript[]): number[] | undefined {
  const peaks = implementers.flatMap(({ text }) => {
    const peak = ContextMeter.ofTranscript(text);
    return peak === undefined ? [] : [peak];
  });
  return peaks.length === implementers.length ? peaks : undefined;
}

function durationMinutesOf(transcripts: Transcript[]): number {
  const ms = transcripts.reduce((sum, { entries }) => {
    const times = entries.flatMap(({ timestamp }) => {
      const time = typeof timestamp === "string" ? Date.parse(timestamp) : NaN;
      return Number.isNaN(time) ? [] : [time];
    });
    if (times.length === 0) return sum;
    return sum + Math.max(...times) - Math.min(...times);
  }, 0);
  return minutesOf(ms);
}

export function minutesOf(ms: number): number {
  return Math.round(ms / 60_000);
}

// Undefined when a model missing from the price table used any tokens.
function costUsdOf(transcripts: Transcript[]): number | undefined {
  const costs = transcripts
    .flatMap(({ entries, subagents }) => [entries, ...subagents])
    .flatMap((entries) => [...repliesOf(entries).values()])
    .map(replyCostOf);
  if (costs.some((cost) => cost === undefined)) return undefined;
  return costs.reduce<number>((sum, cost) => sum + (cost ?? 0), 0);
}

// A reply split across entries repeats its message id; the last entry wins.
function repliesOf(entries: TranscriptEntry[]): Map<unknown, TranscriptEntry> {
  return entries.reduce((replies, entry, index) => {
    if (entry.type !== "assistant") return replies;
    replies.set(entry.message?.id ?? index, entry);
    return replies;
  }, new Map<unknown, TranscriptEntry>());
}

function replyCostOf({ message }: TranscriptEntry): number | undefined {
  const usage = message?.usage ?? {};
  const input = tokensOf(usage.input_tokens);
  const output = tokensOf(usage.output_tokens);
  const cacheRead = tokensOf(usage.cache_read_input_tokens);
  const { fiveMinute, oneHour } = cacheWritesOf(usage);
  const price =
    typeof message?.model === "string"
      ? modelPrices[priceKeyOf(message.model)]
      : undefined;
  if (price === undefined) {
    return input + output + cacheRead + fiveMinute + oneHour === 0
      ? 0
      : undefined;
  }
  const dollarsPerMTok =
    input * price.input +
    output * price.output +
    cacheRead * price.cacheRead +
    fiveMinute * price.input * 1.25 +
    oneHour * price.input * 2;
  return dollarsPerMTok / 1_000_000;
}

// Without a per-duration split, all cache creation is priced as 5-minute writes.
function cacheWritesOf(usage: Usage): CacheWrites {
  if (usage.cache_creation === undefined) {
    return {
      fiveMinute: tokensOf(usage.cache_creation_input_tokens),
      oneHour: 0,
    };
  }
  return {
    fiveMinute: tokensOf(usage.cache_creation.ephemeral_5m_input_tokens),
    oneHour: tokensOf(usage.cache_creation.ephemeral_1h_input_tokens),
  };
}

function tokensOf(tokens: unknown): number {
  return typeof tokens === "number" ? tokens : 0;
}

function priceKeyOf(model: string): string {
  return model.replace(/^claude-/, "").replace(/-\d{8}$/, "");
}

export function percentOf(fraction: number): string {
  return `${Math.round(fraction * 100)}%`;
}
