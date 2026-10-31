// A one-off chore's core (#474): rewrites a written outcome row's transcript facts from sessions a run state recorded
// before it kept each session's config folder. Each session is looked for under every candidate config folder; a fact
// whose transcript is in none of them keeps its written cell. scripts/runner/outcomeBackfill.ts runs it over a spec.

import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { withTranscriptCells } from "./outcomeLog.ts";
import { runStateOf } from "./savedFormats.ts";
import {
  hasTranscript,
  type RecordedSession,
  type StepSession,
  transcriptFactsOf,
} from "./transcriptFacts.ts";

export interface AccountSession extends StepSession {
  account: number;
}

export interface BackfillRequest {
  runStatePath: string;
  // The spec's folder of row files, one per landed ticket.
  specFolder: string;
  configFolders: string[];
}

// Rewrites each ticket's row file the run state has sessions for, returning the paths rewritten.
export function backfillOutcomeRows({
  runStatePath,
  specFolder,
  configFolders,
}: BackfillRequest): string[] {
  const { tickets } = runStateOf(
    JSON.parse(readFileSync(runStatePath, "utf8")),
  );
  return Object.entries(tickets).flatMap(([key, { sessions }]) => {
    const path = join(specFolder, `${key.replace(" #", "-")}.md`);
    if (!existsSync(path) || sessions.length === 0) return [];
    // A step with no recorded account would leave every summed fact short, so the row stays as written.
    const withAccounts = sessions.flatMap(({ agent, sessionId, account }) =>
      account === undefined ? [] : [{ agent, sessionId, account }],
    );
    if (withAccounts.length < sessions.length) return [];
    const file = readFileSync(path, "utf8");
    writeFileSync(
      path,
      backfilledOutcomeFile(file, withAccounts, configFolders),
    );
    return [path];
  });
}

export function backfilledOutcomeFile(
  file: string,
  sessions: AccountSession[],
  configFolders: string[],
): string {
  const steps = sessions.map((session) => recordedOf(session, configFolders));
  return withTranscriptCells(file, transcriptFactsOf({ steps }, []));
}

function recordedOf(
  session: AccountSession,
  configFolders: string[],
): RecordedSession {
  const [firstFolder] = configFolders;
  if (firstFolder === undefined) throw new Error("No config folder given.");
  // A transcript in no folder is missing from each, so any one leaves its facts unrecorded.
  const configFolder =
    configFolders.find((folder) => hasTranscript(folder, session.sessionId)) ??
    firstFolder;
  return { ...session, configFolder };
}
