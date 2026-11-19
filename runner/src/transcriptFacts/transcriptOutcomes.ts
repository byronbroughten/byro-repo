// The outcome facts a wrap-up computes from transcripts instead of asking: pair, peak context, duration, API-equivalent
// cost, review cost, accounts and session ids, from each session id the runner records with its account and config folder.
// A fact is computed only when every transcript it reads is found; otherwise it stays undefined and is written `unrecorded`,
// and a run's landing logs a warning naming it and why (SpecRun/TicketLander.ts).
// Peak context is contextMeter.ts; the row format is outcomeLog.ts; WrapUp.ts merges these over the passed facts.

import { ContextMeter } from "../contextMeter.ts";
import type { OutcomeFacts } from "../outcomeLog.ts";
import { subagentToolNames } from "../StepStream.ts";
import { ReviewResumes } from "./ReviewResumes.ts";
import {
  entriesOf,
  projectDirsOf,
  timeOf,
  type Transcript,
  type TranscriptEntry,
  transcriptOf,
  transcriptsOf,
} from "./transcriptLocation.ts";
import { priceKeyOf } from "./transcriptPricing.ts";

export type StepAgent = "implement" | "research" | "review" | "resolve";

export interface StepSession {
  agent: StepAgent;
  sessionId: string;
  // The ISO time its step launched; none on a session recorded before #759.
  startedAt?: string;
}

// A session's id and the config folder its transcript is under.
export interface TranscriptSession {
  sessionId: string;
  configFolder: string;
}

// With the account it ran as and the config folder its transcript is under.
export interface RecordedSession extends StepSession, TranscriptSession {
  account: number;
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

const syntheticModel = "<synthetic>";
const handoffSessionLine = /^session: (\S+)$/;

export function transcriptFactsOf(
  sessions: TicketSessions,
  { handoffSessionIds, silenceTimeoutMs }: TranscriptFactsRequest,
): OutcomeFacts {
  const projectDirs = projectDirsBySessionOf(sessions, handoffSessionIds);
  const ids = factIdsOf(sessions, handoffSessionIds);
  const resumes = ReviewResumes.init(sessions);
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
      resumes.costUsdOf(found, "implementer"),
    ),
    reviewCostUsd: factOf(
      transcriptsOf(projectDirs, ids.reviewCostUsd),
      (found) => resumes.costUsdOf(found, "review"),
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

function missingReasonOf(missing: RecordedSession[]): string {
  return missing
    .map(
      ({ sessionId, configFolder }) =>
        `no transcript for session ${sessionId} under ${configFolder}`,
    )
    .join("; ");
}

// The subagents a session's main loop started from `since` on, each call once; undefined when its transcript isn't found.
export function spawnedSubagentCountOf(
  { sessionId, configFolder }: TranscriptSession,
  since: number,
): number | undefined {
  const transcript = transcriptOf(projectDirsOf(configFolder), sessionId);
  if (transcript === undefined) return undefined;
  const calls = new Set(
    transcript.entries.flatMap((entry) => {
      if (entry.type !== "assistant" || entry.isSidechain === true) return [];
      if ((timeOf(entry) ?? -Infinity) < since) return [];
      return subagentCallIdsOf(entry.message?.content);
    }),
  );
  return calls.size;
}

function subagentCallIdsOf(content: unknown): string[] {
  if (!Array.isArray(content)) return [];
  return content.flatMap((block) => {
    const isCall =
      block?.type === "tool_use" &&
      subagentToolNames.has(block.name) &&
      typeof block.id === "string";
    return isCall ? [block.id as string] : [];
  });
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

function factOf<RV>(
  transcripts: Transcript[] | undefined,
  compute: (found: Transcript[]) => RV | undefined,
): RV | undefined {
  if (transcripts === undefined) return undefined;
  return compute(transcripts);
}

export function stepIdsOf(
  sessions: TicketSessions,
  agent: StepAgent,
): string[] {
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

export function isMainLoopReply(
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

export function minutesOf(ms: number): number {
  return Math.round(ms / 60_000);
}

export function percentOf(fraction: number): string {
  return `${Math.round(fraction * 100)}%`;
}
