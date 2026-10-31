// Prints the calls the developer or auto mode's classifier had to answer in this repo's recent sessions, grouped by command, with what the tier gate says about each now.
// The transcripts record who answered each call (transcriptCalls.ts), each Bash call replays through the gate at its own folder (gateReplay.ts), and promptReport.ts words the report.
// What to do with the report: the /prompt-scan skill.
import { execFileSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join, sep } from "node:path";
import { parseArgs } from "node:util";

import { configFolderOf } from "@byronbroughten/spec-runner/transcriptFacts";

import { shellPlacesAt } from "../../.claude/hooks/lib/gateLookups.ts";
import { dryRunChoresOf } from "../../.claude/hooks/lib/tiers/tiers.ts";
import { type GateReplay, gateReplayOf } from "./gateReplay.ts";
import {
  answererOf,
  promptReportOf,
  type ScannedCall,
} from "./promptReport.ts";
import { type RecordedCall, recordedCallsOf } from "./transcriptCalls.ts";

const usage = "usage: npm run prompt:scan [-- --sessions <n>] [--top <n>]";

try {
  const { values } = parseArgs({
    options: {
      sessions: { type: "string", default: "50" },
      top: { type: "string", default: "20" },
    },
  });
  const primaryRoot = primaryRootOf();
  const transcripts = transcriptPathsOf(primaryRoot).slice(
    0,
    countOf(values.sessions),
  );
  const calls = transcripts.flatMap((path) =>
    scannedCallsOf(readFileSync(path, "utf8"), primaryRoot),
  );
  console.log(
    promptReportOf({
      calls,
      sessionCount: transcripts.length,
      top: countOf(values.top),
    }),
  );
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
}

function countOf(text: string): number {
  const count = Number(text);
  if (!Number.isInteger(count) || count < 1) throw new Error(usage);
  return count;
}

// The checkout whose git folder every workspace shares, so a scan from a workspace reads the same sessions.
function primaryRootOf(): string {
  const gitFolder = execFileSync(
    "git",
    ["rev-parse", "--path-format=absolute", "--git-common-dir"],
    { encoding: "utf8" },
  );
  return dirname(gitFolder.trim());
}

// Claude Code names a project's transcript folder for its root, each character but a letter or digit a `-`; a workspace's folder extends the primary's.
function transcriptPathsOf(primaryRoot: string): string[] {
  const projects = join(configFolderOf(process.env, homedir()), "projects");
  const folder = primaryRoot.replace(/[^a-zA-Z0-9]/g, "-");
  return readdirSync(projects)
    .filter(
      (name) =>
        name === folder || name.startsWith(`${folder}--claude-worktrees-`),
    )
    .flatMap((name) =>
      readdirSync(join(projects, name))
        .filter((file) => file.endsWith(".jsonl"))
        .map((file) => join(projects, name, file)),
    )
    .map((path) => ({ path, modifiedMs: statSync(path).mtimeMs }))
    .sort((left, right) => right.modifiedMs - left.modifiedMs)
    .map(({ path }) => path);
}

// Replayed in order, so an `app:chore --send` sees the dry runs its session ran before it.
function scannedCallsOf(jsonl: string, primaryRoot: string): ScannedCall[] {
  const dryRuns: string[] = [];
  const scanned: ScannedCall[] = [];
  recordedCallsOf(jsonl).forEach((call) => {
    if (answererOf(call.permission)) {
      scanned.push({ call, replay: replayOf(call, primaryRoot, dryRuns) });
    }
    if (call.command) dryRuns.push(...dryRunChoresOf(call.command));
  });
  return scanned;
}

// A removed workspace replays at the primary root, which has the same layout, so its paths keep their verdicts.
function replayOf(
  call: RecordedCall,
  primaryRoot: string,
  dryRuns: string[],
): GateReplay | undefined {
  const { command, cwd = primaryRoot } = call;
  if (command === undefined) return undefined;
  const sessionRoot = sessionRootOf(cwd, primaryRoot);
  const standIn = existsSync(sessionRoot) ? sessionRoot : primaryRoot;
  return gateReplayOf({
    command: command.replaceAll(sessionRoot, standIn),
    mode: "interactive",
    dryRuns: [...dryRuns],
    places: shellPlacesAt(standIn, cwd.replaceAll(sessionRoot, standIn)),
  });
}

// A folder under `.claude/worktrees/` belongs to that workspace's session; any other, to one started at the primary root.
function sessionRootOf(cwd: string, primaryRoot: string): string {
  const worktrees = join(primaryRoot, ".claude", "worktrees") + sep;
  if (!cwd.startsWith(worktrees)) return primaryRoot;
  const [workspace = ""] = cwd.slice(worktrees.length).split(sep);
  return join(worktrees, workspace);
}
