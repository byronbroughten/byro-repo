// PostToolUse on Read or Bash records a full read of each read-first doc, and a Read of a file a row would gate names that row's unread docs once per session; PreToolUse on a row's tools denies a call the row covers until each of its docs is recorded.
import { existsSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

import { clonePathsOf } from "@byronbroughten/spec-runner/clonePaths";

import { isFullDocBashRead, isFullDocRead } from "./lib/fullDocRead.ts";
import {
  type HookInput,
  lineCount,
  projectDirOf,
  readHookInput,
  runFailOpen,
  sessionStatePath,
  writeDenyOutput,
  writeHookOutput,
} from "./lib/hookIo.ts";
import { rootRelative } from "./lib/lintSet.ts";
import {
  nudgeMarker,
  type ReadFirstCall,
  readFirstDecision,
  type ReadFirstDoc,
  readFirstNudge,
  readFirstRows,
} from "./lib/readFirstGate.ts";
import { readSheetsConfigs } from "./lib/sheetsConfigs.ts";
import { BashReads } from "./lib/tiers/bashReads.ts";

const readFirstDocs = readFirstRows.flatMap((row) => row.docs);

await runFailOpen(() => {
  const input = readHookInput();
  if (!input) return;
  const projectDir = projectDirOf(input);
  if (input.hook_event_name === "PostToolUse") {
    docsReadBy(input, projectDir).forEach((doc) => {
      writeFileSync(markerPath(input, doc), "");
    });
    if (input.tool_name === "Read") nudgeUnreadDocs(input, projectDir);
    return;
  }
  const { denyReason } = readFirstDecision(
    { ...callOf(input, projectDir), toolName: input.tool_name },
    docsReadIn(input),
  );
  if (denyReason) writeDenyOutput(denyReason);
});

function nudgeUnreadDocs(input: HookInput, projectDir: string): void {
  const nudged = readFirstRows
    .map(nudgeMarker)
    .filter((marker) => existsSync(sessionStatePath(input.session_id, marker)));
  const { context, markers } = readFirstNudge(
    callOf(input, projectDir),
    docsReadIn(input),
    nudged,
  );
  markers.forEach((marker) => {
    writeFileSync(sessionStatePath(input.session_id, marker), "");
  });
  if (context === undefined) return;
  writeHookOutput({
    hookSpecificOutput: {
      hookEventName: "PostToolUse",
      additionalContext: context,
    },
  });
}

function callOf(
  input: HookInput,
  projectDir: string,
): Omit<ReadFirstCall, "toolName"> {
  return {
    projectDir,
    cwd: input.cwd ?? projectDir,
    toolInput: input.tool_input,
    generatedDirs: readSheetsConfigs(projectDir).map(
      ({ generatedDir }) => generatedDir,
    ),
    clonePaths: clonePathsOf(projectDir),
  };
}

function docsReadIn(input: HookInput): string[] {
  return readFirstDocs
    .filter((doc) => existsSync(markerPath(input, doc)))
    .map((doc) => doc.path);
}

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
  const target = rootRelative(where);
  const { offset, limit } = input.tool_input ?? {};
  return readFirstDocs.filter(
    (doc) =>
      doc.path === target &&
      isFullDocRead(
        {
          ...where,
          offset,
          limit,
          totalLines: lineCount(resolve(cwd, filePath)),
        },
        doc.path,
      ),
  );
}

function markerPath(input: HookInput, doc: ReadFirstDoc): string {
  return sessionStatePath(input.session_id, doc.marker);
}
