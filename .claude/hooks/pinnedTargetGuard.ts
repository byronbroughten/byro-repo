// PreToolUse on Bash and gworkspace Sheets writes: a dev write asks while a pin is off; a Sheets write is allowed only on the pinned dev ID.
import { spawnSync } from "node:child_process";

import { readHookInput, runFailOpen, writeHookOutput } from "./lib/hookIo.ts";
import {
  bashDecision,
  type Decision,
  type DirtyPinningFiles,
  pinnedDevSpreadsheetId,
  pinningFiles,
  pinsOff,
  sheetsWriteDecision,
} from "./lib/pinnedTargets.ts";
import { readSheetsConfigs } from "./lib/sheetsConfigs.ts";

await runFailOpen(() => {
  const input = readHookInput();
  if (!input) return;
  const projectDir =
    process.env.CLAUDE_PROJECT_DIR ?? input.cwd ?? process.cwd();
  let decision: Decision | undefined;
  if (input.tool_name === "Bash") {
    const command = input.tool_input?.command;
    if (typeof command !== "string") return;
    decision = bashDecision({
      command,
      dirtyPinningFiles: pinsOffIn(projectDir),
    });
  } else {
    decision = sheetsWriteDecision({
      toolName: input.tool_name,
      spreadsheetId: input.tool_input?.spreadsheet_id,
      devSpreadsheetId: pinnedDevSpreadsheetId,
      dirtyPinningFiles: pinsOffIn(projectDir),
    });
  }
  if (!decision) return;
  writeHookOutput({
    hookSpecificOutput: {
      hookEventName: "PreToolUse",
      permissionDecision: decision.permissionDecision,
      permissionDecisionReason: decision.reason,
    },
  });
});

function pinsOffIn(projectDir: string): DirtyPinningFiles {
  return pinsOff(dirtyFiles(projectDir), configDevSpreadsheetId(projectDir));
}

function dirtyFiles(projectDir: string): string[] | undefined {
  const { status, stdout } = spawnSync(
    "git",
    ["status", "--porcelain", "--", ...pinningFiles],
    {
      cwd: projectDir,
      encoding: "utf8",
    },
  );
  if (status !== 0) return undefined;
  return stdout
    .split("\n")
    .filter(Boolean)
    .map((line) => line.slice(3));
}

function configDevSpreadsheetId(projectDir: string): string | undefined {
  return readSheetsConfigs(projectDir).find(
    ({ scriptPrefix }) => scriptPrefix === "dev",
  )?.spreadsheetId;
}
