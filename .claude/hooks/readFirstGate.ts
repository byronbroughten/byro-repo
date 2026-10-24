// PostToolUse on Read or Bash records a full read of each read-first doc; PreToolUse on a row's tools denies a call the row covers until each of its docs is recorded.
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
  type ReadFirstDoc,
  readFirstRows,
} from "./lib/readFirstGate.ts";
import { readSheetsConfigs } from "./lib/sheetsConfigs.ts";
import { BashReads } from "./lib/tiers/bashReads.ts";

const readFirstDocs = readFirstRows.flatMap((row) => row.docs);

await runFailOpen(() => {
  const input = readHookInput();
  if (!input) return;
  const projectDir =
    process.env.CLAUDE_PROJECT_DIR ?? input.cwd ?? process.cwd();
  if (input.hook_event_name === "PostToolUse") {
    docsReadBy(input, projectDir).forEach((doc) => {
      writeFileSync(markerPath(input, doc), "");
    });
    return;
  }
  const docsRead = readFirstDocs
    .filter((doc) => existsSync(markerPath(input, doc)))
    .map((doc) => doc.path);
  const { denyReason } = readFirstDecision(
    {
      projectDir,
      cwd: input.cwd ?? projectDir,
      toolName: input.tool_name,
      toolInput: input.tool_input,
      generatedDirs: readSheetsConfigs(projectDir).map(
        ({ generatedDir }) => generatedDir,
      ),
    },
    docsRead,
  );
  if (denyReason) writeDenyOutput(denyReason);
});

function docsReadBy(input: HookInput, projectDir: string): ReadFirstDoc[] {
  const cwd = input.cwd ?? projectDir;
  const command = input.tool_input?.command;
  if (input.tool_name === "Bash" && typeof command === "string") {
    const wholeFilePaths = BashReads.init({
      command,
      cwd,
      projectDir,
    }).wholeFilePaths();
    return readFirstDocs.filter((doc) =>
      isFullDocBashRead(projectDir, wholeFilePaths, doc.path),
    );
  }
  const filePath = input.tool_input?.file_path;
  if (input.tool_name !== "Read" || typeof filePath !== "string") return [];
  const where = { projectDir, cwd, filePath };
  const target = projectRelative(where);
  const { offset, limit } = input.tool_input ?? {};
  return readFirstDocs.filter(
    (doc) =>
      doc.path === target &&
      isFullDocRead(
        {
          ...where,
          offset,
          limit,
          totalLines: lineCount(join(projectDir, doc.path)),
        },
        doc.path,
      ),
  );
}

function markerPath(input: HookInput, doc: ReadFirstDoc): string {
  return sessionStatePath(input.session_id, doc.marker);
}
