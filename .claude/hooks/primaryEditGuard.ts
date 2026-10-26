// PreToolUse on Edit, Write, NotebookEdit and Bash: denies an edit or commit left in a primary checkout, where runs land.
import { spawnSync } from "node:child_process";
import { existsSync, realpathSync } from "node:fs";
import { basename, dirname, join } from "node:path";

import { primaryCheckoutsOf, primaryRootOf } from "./lib/branchRecords.ts";
import {
  projectDirOf,
  readHookInput,
  runFailOpen,
  writeDenyOutput,
} from "./lib/hookIo.ts";
import { primaryEditDecision } from "./lib/primaryEditGuard.ts";

const guardedTools = new Set(["Edit", "Write", "NotebookEdit", "Bash"]);

await runFailOpen(() => {
  const input = readHookInput();
  const toolInput = input?.tool_input;
  if (!guardedTools.has(input?.tool_name ?? "") || toolInput === undefined) {
    return;
  }
  const projectDir = projectDirOf(input);
  const primaryRoot = primaryRootOf(projectDir);
  if (primaryRoot === undefined) return;
  const decision = primaryEditDecision({
    toolInput,
    cwd: realPathOf(input?.cwd ?? projectDir),
    primaryCheckouts: primaryCheckoutsOf(primaryRoot).map(realPathOf),
    realPathOf,
    isIgnored,
  });
  if (decision.permissionDecision === "deny") writeDenyOutput(decision.reason);
});

// A new file's path resolves through its nearest existing folder.
function realPathOf(path: string): string {
  if (existsSync(path)) return realpathSync(path);
  const parent = dirname(path);
  if (parent === path) return path;
  return join(realPathOf(parent), basename(path));
}

// Without --no-index a tracked file is never ignored, so it is denied; a git error counts as ignored, failing open.
function isIgnored(checkout: string, path: string): boolean {
  const { status } = spawnSync("git", ["check-ignore", "-q", path], {
    cwd: checkout,
  });
  return status !== 1;
}
