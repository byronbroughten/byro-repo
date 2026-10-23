// PostToolUse on Read or Bash records a full read of docs/prose-style.md; PreToolUse on Edit and Write denies a gated markdown edit until one is recorded.
import { existsSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { BashReads } from "./lib/bashReads.ts";
import {
  lineCount,
  readHookInput,
  runFailOpen,
  sessionStatePath,
  writeDenyOutput,
} from "./lib/hookIo.ts";
import {
  editDecision,
  isProseBashRead,
  isProseRead,
  prosePath,
} from "./lib/proseGate.ts";

await runFailOpen(() => {
  const input = readHookInput();
  if (!input) return;
  const projectDir =
    process.env.CLAUDE_PROJECT_DIR ?? input.cwd ?? process.cwd();
  const markerPath = sessionStatePath(input.session_id, "prose-read");
  const command = input.tool_input?.command;
  if (
    input.hook_event_name === "PostToolUse" &&
    input.tool_name === "Bash" &&
    typeof command === "string"
  ) {
    const wholeFilePaths = BashReads.init({
      command,
      cwd: input.cwd ?? projectDir,
      projectDir,
    }).wholeFilePaths();
    if (isProseBashRead(projectDir, wholeFilePaths)) {
      writeFileSync(markerPath, "");
    }
    return;
  }
  const filePath = input.tool_input?.file_path;
  if (typeof filePath !== "string") return;
  const where = { projectDir, cwd: input.cwd ?? projectDir, filePath };
  if (input.hook_event_name === "PostToolUse") {
    if (input.tool_name !== "Read") return;
    const { offset, limit } = input.tool_input ?? {};
    if (
      isProseRead({
        ...where,
        offset,
        limit,
        totalLines: lineCount(join(projectDir, prosePath)),
      })
    ) {
      writeFileSync(markerPath, "");
    }
    return;
  }
  if (!["Edit", "Write"].includes(input.tool_name ?? "")) return;
  const { denyReason } = editDecision({
    ...where,
    hasReadProse: existsSync(markerPath),
  });
  if (!denyReason) return;
  writeDenyOutput(denyReason);
});
