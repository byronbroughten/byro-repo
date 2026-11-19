// Where transcripts are: the config folders, a session's transcript and the main-session transcripts started in a date range.
// transcriptFacts.ts re-exports the public members; projectDirsOf, entriesOf, transcriptOf and transcriptsOf stay inside the folder.

import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

export interface TranscriptEntry {
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

export interface Usage {
  input_tokens?: unknown;
  output_tokens?: unknown;
  cache_read_input_tokens?: unknown;
  cache_creation_input_tokens?: unknown;
  cache_creation?: {
    ephemeral_5m_input_tokens?: unknown;
    ephemeral_1h_input_tokens?: unknown;
  };
}

export interface Transcript extends SessionEntries {
  sessionId: string;
  text: string;
}

export interface SessionEntries {
  entries: TranscriptEntry[];
  subagents: TranscriptEntry[][];
}

// A main-session transcript found by date, without its subagents'.
export type LocalTranscript = Pick<Transcript, "sessionId" | "entries">;

export interface DateRange {
  from: Date;
  to: Date;
}

// The config folder a claude process started from `env` writes its transcripts under.
export function configFolderOf(
  env: NodeJS.ProcessEnv,
  homeFolder: string,
): string {
  return env.CLAUDE_CONFIG_DIR ?? join(homeFolder, ".claude");
}

// The config folders a transcript may be under: the live one and each cswap account's backup.
export function accountConfigFoldersOf(
  env: NodeJS.ProcessEnv,
  homeFolder: string,
): string[] {
  const backups = join(homeFolder, ".claude-swap-backup", "sessions");
  const accounts = existsSync(backups)
    ? readdirSync(backups, { withFileTypes: true })
        .filter((entry) => entry.isDirectory())
        .map((entry) => join(backups, entry.name))
    : [];
  return [configFolderOf(env, homeFolder), ...accounts];
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

// Each main session started in the range, once by id; a subagent's transcript sits a folder deeper, so is left out.
export function localTranscriptsOf(
  configFolders: string[],
  { from, to }: DateRange,
): LocalTranscript[] {
  const bySession = new Map<string, LocalTranscript>();
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
): LocalTranscript[] {
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

export function projectDirsOf(configFolder: string): string[] {
  const projects = join(configFolder, "projects");
  if (!existsSync(projects)) return [];
  return readdirSync(projects).map((name) => join(projects, name));
}

// Undefined when any id's transcript is missing, or with no id, so a fact with no session is unrecorded rather than zero.
export function transcriptsOf(
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

export function transcriptOf(
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

export function entriesOf(text: string): TranscriptEntry[] {
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

export function timeOf({ timestamp }: TranscriptEntry): number | undefined {
  const time = typeof timestamp === "string" ? Date.parse(timestamp) : NaN;
  return Number.isNaN(time) ? undefined : time;
}
