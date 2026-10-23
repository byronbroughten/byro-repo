// postToolUse on Read records a full read of a style doc; preToolUse on Write denies a gated code edit until the docs that file needs are recorded.
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import {
  isFullDocRead,
  isPostToolUse,
} from "../../.claude/hooks/lib/fullDocRead.ts";
import {
  readHookInput,
  runFailOpen,
  sessionStatePath,
  writeHookOutput,
} from "../../.claude/hooks/lib/hookIo.ts";
import { readSheetsConfigs } from "../../.claude/hooks/lib/sheetsConfigs.ts";
import {
  cursorEditDecision,
  cursorFilePath,
  cursorReadBounds,
  frameworkStylePath,
  stylePath,
} from "../../.claude/hooks/lib/styleGate.ts";

const editTools = ["Edit", "Write", "StrReplace"];

await runFailOpen(() => {
  const input = readHookInput();
  if (!input) return;
  const filePath = cursorFilePath(input.tool_input);
  if (filePath === undefined) return;
  const projectDir =
    process.env.CURSOR_PROJECT_DIR ??
    process.env.CLAUDE_PROJECT_DIR ??
    input.workspace_roots?.[0] ??
    input.cwd ??
    process.cwd();
  const where = { projectDir, cwd: input.cwd ?? projectDir, filePath };
  const sessionId = input.session_id ?? input.conversation_id;
  const markerPaths = {
    general: sessionStatePath(sessionId, "style-read"),
    framework: sessionStatePath(sessionId, "framework-style-read"),
  };
  if (isPostToolUse(input.hook_event_name)) {
    if (input.tool_name !== "Read") return;
    const bounds = cursorReadBounds(input.tool_input);
    if (!bounds) return;
    [
      { docPath: stylePath, markerPath: markerPaths.general },
      { docPath: frameworkStylePath, markerPath: markerPaths.framework },
    ].forEach(({ docPath, markerPath }) => {
      let totalLines: number | undefined;
      if (bounds.limit !== undefined) {
        totalLines = lineCount(join(projectDir, docPath));
      }
      if (isFullDocRead({ ...where, ...bounds, totalLines }, docPath)) {
        writeFileSync(markerPath, "");
      }
    });
    return;
  }
  if (!editTools.includes(input.tool_name ?? "")) return;
  const { denyReason } = cursorEditDecision({
    ...where,
    reads: {
      hasReadGeneral: existsSync(markerPaths.general),
      hasReadFramework: existsSync(markerPaths.framework),
    },
    generatedDirs: readSheetsConfigs(projectDir).map(
      ({ generatedDir }) => generatedDir,
    ),
  });
  if (!denyReason) {
    writeHookOutput({ permission: "allow" });
    return;
  }
  writeHookOutput({
    permission: "deny",
    user_message: denyReason,
    agent_message: denyReason,
  });
});

function lineCount(path: string): number {
  return readFileSync(path, "utf8").replace(/\n$/, "").split("\n").length;
}
