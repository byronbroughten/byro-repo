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

export type StepAgent = "implement" | "research" | "review" | "resolve";

export interface StepSession {
  agent: StepAgent;
  sessionId: string;
  // The ISO time its step launched; none on a session recorded before #759.
  startedAt?: string;
}

// With the account it ran as and the config folder its transcript is under.
export interface RecordedSession extends StepSession {
  account: number;
  configFolder: string;
}

export interface TicketSessions {
  steps: RecordedSession[];
}

export interface TranscriptFactsRequest {
  handoffSessionIds: string[];
  // The run's silence timeout: a longer gap between entries falls between two runs of a session, as a Halt or Limit wait.
  silenceTimeoutMs: number;
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
  isMeta?: unknown;
  isCompactSummary?: unknown;
  timestamp?: unknown;
  effort?: unknown;
  origin?: { kind?: unknown };
  message?: {
    id?: unknown;
    model?: unknown;
    content?: unknown;
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

interface Transcript extends SessionEntries {
  sessionId: string;
  text: string;
}

interface SessionEntries {
  entries: TranscriptEntry[];
  subagents: TranscriptEntry[][];
}

type CostSide = "implementer" | "review";

// Where a session the review resumed splits: at the first review step's recorded start, or without one at the
// prompt of its first review-side launch.
interface ReviewResume {
  promptIndex: number;
  reviewStartedAt: number | undefined;
}

type ReviewResumes = Map<string, ReviewResume>;

interface ReviewCut {
  index: number;
  time: number;
}

const syntheticModel = "<synthetic>";
const taskNotificationKind = "task-notification";
const handoffSessionLine = /^session: (\S+)$/;

// The config folder a claude process started from `env` writes its transcripts under.
export function configFolderOf(
  env: NodeJS.ProcessEnv,
  homeFolder: string,
): string {
  return env.CLAUDE_CONFIG_DIR ?? join(homeFolder, ".claude");
}

export function hasTranscript(
  configFolder: string,
  sessionId: string,
): boolean {
  const projects = join(configFolder, "projects");
  if (!existsSync(projects)) return false;
  return readdirSync(projects).some((name) =>
    existsSync(join(projects, name, `${sessionId}.jsonl`)),
  );
}

export function transcriptFactsOf(
  sessions: TicketSessions,
  { handoffSessionIds, silenceTimeoutMs }: TranscriptFactsRequest,
): OutcomeFacts {
  const projectDirs = projectDirsBySessionOf(sessions, handoffSessionIds);
  const ids = factIdsOf(sessions, handoffSessionIds);
  const resumes = reviewResumesOf(sessions);
  const implementers = transcriptsOf(projectDirs, ids.pair);
  const accounts = unique(sessions.steps.map(({ account }) => String(account)));
  return {
    account: accounts.length === 0 ? undefined : accounts.join(", "),
    sessionIds: ids.durationMinutes,
    pair: factOf(implementers, pairOf),
    peakContext: factOf(implementers, peaksOf),
    durationMinutes: factOf(
      transcriptsOf(projectDirs, ids.durationMinutes),
      (transcripts) => durationMinutesOf(transcripts, silenceTimeoutMs),
    ),
    costUsd: factOf(implementers, (found) =>
      sideCostUsdOf(found, { side: "implementer", resumes }),
    ),
    reviewCostUsd: factOf(
      transcriptsOf(projectDirs, ids.reviewCostUsd),
      (found) => sideCostUsdOf(found, { side: "review", resumes }),
    ),
  };
}

// Each transcript fact transcriptFactsOf leaves unrecorded although a step it reads ran, and why.
export function unrecordedFactsOf(
  sessions: TicketSessions,
  silenceTimeoutMs: number,
): UnrecordedFact[] {
  const facts = transcriptFactsOf(sessions, {
    handoffSessionIds: [],
    silenceTimeoutMs,
  });
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

// A post-review `implement` resume that comes before resolve is a budget handoff, implementation work, so it stays in cost.
function reviewResumesOf(sessions: TicketSessions): ReviewResumes {
  const implementerIds = new Set(stepIdsOf(sessions, "implement"));
  const firstReview = sessions.steps.find(({ agent }) => agent === "review");
  const reviewStartedAt =
    firstReview?.startedAt === undefined
      ? undefined
      : Date.parse(firstReview.startedAt);
  const launchCounts = new Map<string, number>();
  const resumes: ReviewResumes = new Map();
  let hasReviewRun = false;
  for (const { agent, sessionId } of sessions.steps) {
    const promptIndex = launchCounts.get(sessionId) ?? 0;
    launchCounts.set(sessionId, promptIndex + 1);
    if (agent === "review") hasReviewRun = true;
    if (
      (agent === "review" || agent === "resolve") &&
      hasReviewRun &&
      implementerIds.has(sessionId) &&
      !resumes.has(sessionId)
    ) {
      resumes.set(sessionId, { promptIndex, reviewStartedAt });
    }
  }
  return resumes;
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
    sessionId,
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

// Sums the gaps between consecutive entries, leaving out each over the cap, so a Halt or Limit wait is no working time.
function durationMinutesOf(transcripts: Transcript[], capMs: number): number {
  const ms = transcripts.reduce((sum, { entries }) => {
    const times = entries
      .flatMap((entry) => {
        const time = timeOf(entry);
        return time === undefined ? [] : [time];
      })
      .sort((a, b) => a - b);
    return times.reduce((total, time, index) => {
      const gap = time - (times[index - 1] ?? time);
      return gap > capMs ? total : total + gap;
    }, sum);
  }, 0);
  return minutesOf(ms);
}

function timeOf({ timestamp }: TranscriptEntry): number | undefined {
  const time = typeof timestamp === "string" ? Date.parse(timestamp) : NaN;
  return Number.isNaN(time) ? undefined : time;
}

export function minutesOf(ms: number): number {
  return Math.round(ms / 60_000);
}

// An implementer session the review or its resolve resumed splits at the review's cut; any other counts whole toward
// the side that reads it.
function sideCostUsdOf(
  transcripts: Transcript[],
  { side, resumes }: { side: CostSide; resumes: ReviewResumes },
): number | undefined {
  return costUsdOf(
    transcripts.map((transcript) => {
      const resume = resumes.get(transcript.sessionId);
      return resume === undefined
        ? transcript
        : resumeSplitOf(transcript, resume)[side];
    }),
  );
}

// A subagent goes to the side its first timed entry falls on.
function resumeSplitOf(
  { entries, subagents }: Transcript,
  resume: ReviewResume,
): Record<CostSide, SessionEntries> {
  const cut = reviewCutOf(entries, resume);
  if (cut === undefined) {
    return {
      implementer: { entries, subagents },
      review: { entries: [], subagents: [] },
    };
  }
  const split: Record<CostSide, SessionEntries> = {
    implementer: { entries: entries.slice(0, cut.index), subagents: [] },
    review: { entries: entries.slice(cut.index), subagents: [] },
  };
  for (const subagent of subagents) {
    const side = startOf(subagent) < cut.time ? "implementer" : "review";
    split[side].subagents.push(subagent);
  }
  return split;
}

// Undefined for a session recorded with no start whose transcript lacks the resumed launch's prompt.
function reviewCutOf(
  entries: TranscriptEntry[],
  { promptIndex, reviewStartedAt }: ReviewResume,
): ReviewCut | undefined {
  if (reviewStartedAt !== undefined) {
    const index = entries.findIndex(
      (entry) => (timeOf(entry) ?? -Infinity) >= reviewStartedAt,
    );
    return {
      index: index === -1 ? entries.length : index,
      time: reviewStartedAt,
    };
  }
  const prompt = entries.filter(isPrompt)[promptIndex];
  if (prompt === undefined) return undefined;
  return { index: entries.indexOf(prompt), time: timeOf(prompt) ?? Infinity };
}

// A subagent with no timed entry starts before any resume.
function startOf(entries: TranscriptEntry[]): number {
  return entries.map(timeOf).find((time) => time !== undefined) ?? -Infinity;
}

// Each launch writes one: a main-loop user entry that is neither a tool's result nor one Claude Code adds itself.
function isPrompt({
  type,
  isSidechain,
  isMeta,
  isCompactSummary,
  origin,
  message,
}: TranscriptEntry): boolean {
  if (type !== "user" || isSidechain === true) return false;
  if (isMeta === true || isCompactSummary === true) return false;
  if (origin?.kind === taskNotificationKind) return false;
  const content = message?.content;
  if (typeof content === "string") return true;
  return Array.isArray(content) && !content.some(isToolResult);
}

function isToolResult(block: unknown): boolean {
  return (
    typeof block === "object" &&
    block !== null &&
    "type" in block &&
    block.type === "tool_result"
  );
}

// Undefined when a model missing from the price table used any tokens.
function costUsdOf(transcripts: SessionEntries[]): number | undefined {
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
