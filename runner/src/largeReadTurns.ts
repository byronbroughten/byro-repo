// The delegation measurement: for each session kind, the main-loop turns that follow a large Read, each of which carries
// the read's tokens again, and their median. A kind is the runner step or interactive skill a session's prompts name.
// It is the data for a delegation table weighing them against a cold `repo-explorer` spawn (docs/agents/delegation.md).
// The transcript readers are transcriptFacts.ts's; `npm run delegation:measure` (scripts/runner/delegationMeasure.ts)
// prints this over the developer's local transcripts.

import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

import {
  entriesOf,
  isMainLoopReply,
  projectDirsOf,
  timeOf,
  type Transcript,
  type TranscriptEntry,
} from "./transcriptFacts.ts";

// The read-size line: a Read result of 20,000 characters or more, about 5K tokens, is a large read.
export const largeReadChars = 20_000;

export type MeasuredTranscript = Pick<Transcript, "sessionId" | "entries">;

export interface KindTurns {
  kind: string;
  sessionCount: number;
  // One per large read, in transcript order.
  turnsAfter: number[];
  median: number;
}

export interface DateRange {
  from: Date;
  to: Date;
}

interface LargeRead {
  kind: string;
  sessionId: string;
  turnsAfter: number;
}

export const otherKind = "other";

// A runner step's prompt opens by naming its step; a run's review resumes the implementer with its own opening.
const stepOpenings = [
  /^You are the (?<kind>[a-z-]+ step|gap check) of an unattended run/,
  /you now run its (?<kind>review step) in an unattended run/,
];
const slashCommand = /<command-name>\/(?<name>[^<\s]+)<\/command-name>/;
const skillBody = /^Base directory for this skill: (?<path>\S+)/;

// Kinds by large-read count, most first.
export function largeReadTurnsOf(
  transcripts: MeasuredTranscript[],
): KindTurns[] {
  const byKind = transcripts.flatMap(largeReadsOf).reduce((groups, read) => {
    groups.set(read.kind, [...(groups.get(read.kind) ?? []), read]);
    return groups;
  }, new Map<string, LargeRead[]>());
  return [...byKind]
    .map(([kind, reads]) => {
      const turnsAfter = reads.map((read) => read.turnsAfter);
      return {
        kind,
        sessionCount: new Set(reads.map(({ sessionId }) => sessionId)).size,
        turnsAfter,
        median: medianOf(turnsAfter),
      };
    })
    .sort((a, b) => b.turnsAfter.length - a.turnsAfter.length);
}

// Each large read takes the kind of the latest prompt before it that names one; a slash command names its skill only
// once that skill's body follows, which a built-in command such as `/clear` never adds.
function largeReadsOf({ sessionId, entries }: MeasuredTranscript): LargeRead[] {
  const readCallIds = new Set<string>();
  const reads: LargeRead[] = [];
  let kind = otherKind;
  let command: string | undefined;
  for (const [index, entry] of entries.entries()) {
    kind = stepKindOf(entry) ?? kind;
    command = slashCommandOf(entry) ?? command;
    if (command !== undefined && skillBodyNameOf(entry) === command) {
      kind = `/${command}`;
      command = undefined;
    }
    if (isMainLoopReply(entry)) {
      for (const id of readCallIdsOf(entry.message.content)) {
        readCallIds.add(id);
      }
    }
    if (largeReadResultIn(entry, readCallIds)) {
      reads.push({ kind, sessionId, turnsAfter: turnsAfterOf(entries, index) });
    }
  }
  return reads;
}

function stepKindOf(entry: TranscriptEntry): string | undefined {
  const text = promptOf(entry);
  for (const opening of stepOpenings) {
    const kind = text.match(opening)?.groups?.kind;
    if (kind !== undefined) return kind;
  }
  return undefined;
}

function slashCommandOf(entry: TranscriptEntry): string | undefined {
  return promptOf(entry).match(slashCommand)?.groups?.name;
}

function skillBodyNameOf(entry: TranscriptEntry): string | undefined {
  if (entry.type !== "user") return undefined;
  const text = promptTextOf(entry.message?.content);
  return text.match(skillBody)?.groups?.path?.split("/").at(-1);
}

// The developer's or runner's words, never the meta entries Claude Code adds.
function promptOf(entry: TranscriptEntry): string {
  if (entry.type !== "user" || entry.isMeta === true) return "";
  return promptTextOf(entry.message?.content);
}

function promptTextOf(content: unknown): string {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  return content
    .flatMap((block) =>
      block?.type === "text" && typeof block.text === "string"
        ? [block.text as string]
        : [],
    )
    .join("\n");
}

function readCallIdsOf(content: unknown): string[] {
  if (!Array.isArray(content)) return [];
  return content.flatMap((block) =>
    block?.type === "tool_use" &&
    block.name === "Read" &&
    typeof block.id === "string"
      ? [block.id as string]
      : [],
  );
}

function largeReadResultIn(
  entry: TranscriptEntry,
  readCallIds: Set<string>,
): boolean {
  if (entry.type !== "user" || entry.isSidechain === true) return false;
  const content = entry.message?.content;
  if (!Array.isArray(content)) return false;
  return content.some(
    (block) =>
      block?.type === "tool_result" &&
      readCallIds.has(block.tool_use_id) &&
      resultLengthOf(block.content) >= largeReadChars,
  );
}

function resultLengthOf(content: unknown): number {
  if (typeof content === "string") return content.length;
  return promptTextOf(content).length;
}

// The distinct main-loop replies after the read, up to a compaction, which drops it from context.
function turnsAfterOf(entries: TranscriptEntry[], readIndex: number): number {
  const later = entries.slice(readIndex + 1);
  const compaction = later.findIndex(
    (entry) => entry.isCompactSummary === true,
  );
  const inContext = compaction === -1 ? later : later.slice(0, compaction);
  const replyIds = inContext.flatMap((entry, index) =>
    isMainLoopReply(entry) ? [entry.message.id ?? `entry-${index}`] : [],
  );
  return new Set(replyIds).size;
}

function medianOf(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 1) return sorted[middle] ?? 0;
  return ((sorted[middle - 1] ?? 0) + (sorted[middle] ?? 0)) / 2;
}

// Each main-session transcript under the config folders that started in the range, once by session id; subagents'
// transcripts sit a folder deeper and are left out.
export function localTranscriptsOf(
  configFolders: string[],
  { from, to }: DateRange,
): MeasuredTranscript[] {
  const bySession = new Map<string, MeasuredTranscript>();
  for (const projectDir of configFolders.flatMap(projectDirsOf)) {
    for (const found of projectTranscriptsOf(projectDir, from)) {
      const start = found.entries
        .map(timeOf)
        .find((time) => time !== undefined);
      if (
        start === undefined ||
        start < from.getTime() ||
        start >= to.getTime()
      ) {
        continue;
      }
      const held = bySession.get(found.sessionId);
      if (held === undefined || held.entries.length < found.entries.length) {
        bySession.set(found.sessionId, found);
      }
    }
  }
  return [...bySession.values()];
}

// A transcript last written before `from` can't have started in the range, so it is never read.
function projectTranscriptsOf(
  projectDir: string,
  from: Date,
): MeasuredTranscript[] {
  return readdirSync(projectDir, { withFileTypes: true }).flatMap((file) => {
    if (!file.isFile() || !file.name.endsWith(".jsonl")) return [];
    const path = join(projectDir, file.name);
    if (statSync(path).mtimeMs < from.getTime()) return [];
    return [
      {
        sessionId: file.name.slice(0, -".jsonl".length),
        entries: entriesOf(readFileSync(path, "utf8")),
      },
    ];
  });
}
