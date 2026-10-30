// The outcome facts a wrap-up computes from transcripts instead of asking: pair, peak context, duration, API-equivalent
// cost, review cost, accounts and session ids, from each session id the runner records with its account and config folder.
// A fact is computed only when every transcript it reads is found; otherwise it stays undefined and is written `unrecorded`,
// and a run's landing logs a warning naming it and why (SpecRun/TicketLander.ts).
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

// With the account it ran as and the config folder its transcript is under.
export interface RecordedSession extends StepSession {
  account: number;
  configFolder: string;
}

export interface TicketSessions {
  steps: RecordedSession[];
}

// A transcript fact written `unrecorded`, by the name a progress-log warning gives it.
export interface UnrecordedFact {
  label: string;
  reason: string;
}

type TranscriptFact =
  "pair" | "peakContext" | "durationMinutes" | "costUsd" | "reviewCostUsd";

// Each fact's name in a warning, and why it stays unrecorded with every transcript found; none for a fact that can't.
interface FactWording {
  label: string;
  otherwise?: string;
}

const unpricedReason = "a model it used is missing from the price table";

const factWordings: Record<TranscriptFact, FactWording> = {
  pair: { label: "pair", otherwise: "no implementer reply names its effort" },
  peakContext: {
    label: "peak context",
    otherwise: "no implementer transcript has a reply",
  },
  durationMinutes: { label: "duration" },
  costUsd: { label: "cost", otherwise: unpricedReason },
  reviewCostUsd: { label: "review cost", otherwise: unpricedReason },
};

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

// The config folder a claude process started from `env` writes its transcripts under.
export function configFolderOf(
  env: NodeJS.ProcessEnv,
  homeFolder: string,
): string {
  return env.CLAUDE_CONFIG_DIR ?? join(homeFolder, ".claude");
}

export function transcriptFactsOf(
  sessions: TicketSessions,
  handoffSessionIds: string[],
): OutcomeFacts {
  const projectDirs = projectDirsBySessionOf(sessions, handoffSessionIds);
  const ids = factIdsOf(sessions, handoffSessionIds);
  const implementers = transcriptsOf(projectDirs, ids.pair);
  const accounts = unique(sessions.steps.map(({ account }) => String(account)));
  return {
    account: accounts.length === 0 ? undefined : accounts.join(", "),
    sessionIds: ids.durationMinutes,
    pair: factOf(implementers, pairOf),
    peakContext: factOf(implementers, peaksOf),
    durationMinutes: factOf(
      transcriptsOf(projectDirs, ids.durationMinutes),
      durationMinutesOf,
    ),
    costUsd: factOf(implementers, costUsdOf),
    reviewCostUsd: factOf(
      transcriptsOf(projectDirs, ids.reviewCostUsd),
      costUsdOf,
    ),
  };
}

// Each transcript fact transcriptFactsOf leaves unrecorded although a step it reads ran, and why.
export function unrecordedFactsOf(sessions: TicketSessions): UnrecordedFact[] {
  const facts = transcriptFactsOf(sessions, []);
  const ids = factIdsOf(sessions, []);
  const steps = [
    ...new Map(sessions.steps.map((step) => [step.sessionId, step])).values(),
  ];
  const wordings = Object.entries(factWordings) as [
    TranscriptFact,
    FactWording,
  ][];
  return wordings.flatMap(([fact, { label, otherwise }]) => {
    if (ids[fact].length === 0 || facts[fact] !== undefined) return [];
    const missing = steps.filter(
      ({ sessionId, configFolder }) =>
        ids[fact].includes(sessionId) &&
        transcriptOf(projectDirsOf(configFolder), sessionId) === undefined,
    );
    if (missing.length > 0) {
      return [{ label, reason: missingReasonOf(missing) }];
    }
    return otherwise === undefined ? [] : [{ label, reason: otherwise }];
  });
}

// The session ids each transcript fact reads; the review steps' resolves count toward review cost only once a review ran.
function factIdsOf(
  sessions: TicketSessions,
  handoffSessionIds: string[],
): Record<TranscriptFact, string[]> {
  const implementerIds = unique([
    ...handoffSessionIds,
    ...stepIdsOf(sessions, "implement"),
  ]);
  const reviewIds = stepIdsOf(sessions, "review");
  return {
    pair: implementerIds,
    peakContext: implementerIds,
    durationMinutes: unique([
      ...handoffSessionIds,
      ...sessions.steps.map(({ sessionId }) => sessionId),
    ]),
    costUsd: implementerIds,
    reviewCostUsd:
      reviewIds.length === 0
        ? []
        : unique([...reviewIds, ...stepIdsOf(sessions, "resolve")]),
  };
}

function missingReasonOf(missing: RecordedSession[]): string {
  return missing
    .map(
      ({ sessionId, configFolder }) =>
        `no transcript for session ${sessionId} under ${configFolder}`,
    )
    .join("; ");
}

// The latest recorded implementer's peak, as an interactive session is when its review runs; undefined when unreadable.
export function latestImplementPeakOf(
  sessions: TicketSessions,
): number | undefined {
  const latest = sessions.steps.findLast(({ agent }) => agent === "implement");
  if (latest === undefined) return undefined;
  const transcript = transcriptOf(
    projectDirsOf(latest.configFolder),
    latest.sessionId,
  );
  return transcript && ContextMeter.ofTranscript(transcript.text);
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

// The `<Family> <effort>` of a transcript's latest main-loop reply; undefined when it has none or that reply has no effort.
export function latestPairOf(text: string): string | undefined {
  const latest = entriesOf(text).findLast(isMainLoopReply);
  return latest && entryPairOf(latest)[0];
}

// A recorded session is looked for in its own config folder; a handoff, which records none, in every recorded one.
function projectDirsBySessionOf(
  { steps }: TicketSessions,
  handoffSessionIds: string[],
): Map<string, string[]> {
  const byFolder = new Map(
    steps.map(({ configFolder }) => [
      configFolder,
      projectDirsOf(configFolder),
    ]),
  );
  const everyFolder = [...byFolder.values()].flat();
  const bySession = new Map(handoffSessionIds.map((id) => [id, everyFolder]));
  for (const { sessionId, configFolder } of steps) {
    bySession.set(sessionId, byFolder.get(configFolder) ?? []);
  }
  return bySession;
}

function projectDirsOf(configFolder: string): string[] {
  const projects = join(configFolder, "projects");
  if (!existsSync(projects)) return [];
  return readdirSync(projects).map((name) => join(projects, name));
}

// Undefined when any id's transcript is missing, or with no id, so a fact with no session is unrecorded rather than zero.
function transcriptsOf(
  projectDirs: Map<string, string[]>,
  ids: string[],
): Transcript[] | undefined {
  if (ids.length === 0) return undefined;
  const found = ids.flatMap((id) => {
    const transcript = transcriptOf(projectDirs.get(id) ?? [], id);
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
  if (!isMainLoopReply(entry) || typeof entry.effort !== "string") return [];
  const family = priceKeyOf(entry.message.model).split("-")[0] ?? "";
  return [
    `${family.charAt(0).toUpperCase()}${family.slice(1)} ${entry.effort}`,
  ];
}

function isMainLoopReply(
  entry: TranscriptEntry,
): entry is TranscriptEntry & { message: { model: string } } {
  if (entry.type !== "assistant" || entry.isSidechain === true) return false;
  const model = entry.message?.model;
  return typeof model === "string" && model !== syntheticModel;
}

// A transcript with no reply, as a `/clear` successor's or a session quit at once, has no peak to spoil the others.
function peaksOf(implementers: Transcript[]): number[] | undefined {
  const peaks = implementers.flatMap(({ text }) => {
    const peak = ContextMeter.ofTranscript(text);
    return peak === undefined ? [] : [peak];
  });
  return peaks.length === 0 ? undefined : peaks;
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
