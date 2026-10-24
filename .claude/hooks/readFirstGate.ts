// PostToolUse on Read or Bash records a full read of each read-first row's doc; PreToolUse on Edit and Write denies an edit a row covers until that row's doc is recorded.
import { existsSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { isFullDocBashRead, isFullDocRead } from "./lib/fullDocRead.ts";
import {
  type HookInput,
  lineCount,
  readHookInput,
  runFailOpen,
  sessionStatePath,
  writeDenyOutput,
} from "./lib/hookIo.ts";
import { projectRelative } from "./lib/lintSet.ts";
import {
  readFirstDecision,
  type ReadFirstRow,
  readFirstRows,
} from "./lib/readFirstGate.ts";
import { readSheetsConfigs } from "./lib/sheetsConfigs.ts";
import { BashReads } from "./lib/tiers/bashReads.ts";

await runFailOpen(() => {
  const input = readHookInput();
  if (!input) return;
  const projectDir =
    process.env.CLAUDE_PROJECT_DIR ?? input.cwd ?? process.cwd();
  if (input.hook_event_name === "PostToolUse") {
    rowsReadBy(input, projectDir).forEach((row) => {
      writeFileSync(markerPath(input, row), "");
    });
    return;
  }
  if (!["Edit", "Write"].includes(input.tool_name ?? "")) return;
  const filePath = input.tool_input?.file_path;
  if (typeof filePath !== "string") return;
  const docsRead = readFirstRows
    .filter((row) => existsSync(markerPath(input, row)))
    .map((row) => row.docPath);
  const { denyReason } = readFirstDecision(
    {
      projectDir,
      cwd: input.cwd ?? projectDir,
      filePath,
      generatedDirs: readSheetsConfigs(projectDir).map(
        ({ generatedDir }) => generatedDir,
      ),
    },
    docsRead,
  );
  if (denyReason) writeDenyOutput(denyReason);
});

function rowsReadBy(input: HookInput, projectDir: string): ReadFirstRow[] {
  const cwd = input.cwd ?? projectDir;
  const command = input.tool_input?.command;
  if (input.tool_name === "Bash" && typeof command === "string") {
    const wholeFilePaths = BashReads.init({
      command,
      cwd,
      projectDir,
    }).wholeFilePaths();
    return readFirstRows.filter((row) =>
      isFullDocBashRead(projectDir, wholeFilePaths, row.docPath),
    );
  }
  const filePath = input.tool_input?.file_path;
  if (input.tool_name !== "Read" || typeof filePath !== "string") return [];
  const where = { projectDir, cwd, filePath };
  const target = projectRelative(where);
  const { offset, limit } = input.tool_input ?? {};
  return readFirstRows.filter(
    (row) =>
      row.docPath === target &&
      isFullDocRead(
        {
          ...where,
          offset,
          limit,
          totalLines: lineCount(join(projectDir, row.docPath)),
        },
        row.docPath,
      ),
  );
}

function markerPath(input: HookInput, row: ReadFirstRow): string {
  return sessionStatePath(input.session_id, row.marker);
}
