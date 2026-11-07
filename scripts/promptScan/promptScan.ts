// Prints every stop in this repo's recent sessions: the calls the developer or auto mode's classifier had to answer, hook refusals, sandbox denials, Hand-backs and Claude Code's removal check, grouped by command, with what the tier gate says about each now.
// The transcripts record who answered each call and what stopped it (transcriptCalls.ts), each Bash call replays through the gate under this checkout's sandbox state (gateReplay.ts), and promptReport.ts words the report.
// What to do with the report: the /prompt-scan skill.
import { execFileSync } from "node:child_process";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { parseArgs } from "node:util";

import { configFolderOf } from "@byronbroughten/spec-runner/transcriptFacts";

import {
  callSandboxOf,
  sessionSandboxStateOf,
} from "../../.claude/hooks/lib/sandboxState.ts";
import { scannedCallsOf } from "./gateReplay.ts";
import { promptReportOf } from "./promptReport.ts";

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
  // Read once: every call replays under this checkout's sandbox, as the tier gate reads it.
  const sandbox = callSandboxOf(sessionSandboxStateOf(undefined));
  const calls = transcripts.flatMap((path) =>
    scannedCallsOf(readFileSync(path, "utf8"), sandbox),
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
