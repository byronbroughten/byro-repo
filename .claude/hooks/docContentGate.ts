// PostToolUse on Read records a full read of docs/writing-voice.md or docs/writing-craft.md; PreToolUse on the gworkspace Doc writes denies a text write until both are recorded.
import { existsSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import {
  docWriteDecision,
  type WritingSheet,
  writingSheetPaths,
  writingSheets,
} from "./lib/docContentGate.ts";
import { isFullDocRead, isPostToolUse } from "./lib/fullDocRead.ts";
import {
  lineCount,
  readHookInput,
  runFailOpen,
  sessionStatePath,
  writeDenyOutput,
} from "./lib/hookIo.ts";

await runFailOpen(() => {
  const input = readHookInput();
  if (!input) return;
  const sessionId = input.session_id ?? input.conversation_id;
  if (isPostToolUse(input.hook_event_name)) {
    const filePath = input.tool_input?.file_path;
    if (input.tool_name !== "Read" || typeof filePath !== "string") return;
    const projectDir =
      process.env.CLAUDE_PROJECT_DIR ?? input.cwd ?? process.cwd();
    const { offset, limit } = input.tool_input ?? {};
    writingSheets.forEach((sheet) => {
      const totalLines = lineCount(join(projectDir, writingSheetPaths[sheet]));
      if (
        isFullDocRead(
          {
            projectDir,
            cwd: input.cwd ?? projectDir,
            filePath,
            offset,
            limit,
            totalLines,
          },
          writingSheetPaths[sheet],
        )
      ) {
        writeFileSync(markerPath(sessionId, sheet), "");
      }
    });
    return;
  }
  const { denyReason } = docWriteDecision({
    toolName: input.tool_name,
    toolInput: input.tool_input,
    readSheets: writingSheets.filter((sheet) =>
      existsSync(markerPath(sessionId, sheet)),
    ),
  });
  if (!denyReason) return;
  writeDenyOutput(denyReason);
});

function markerPath(
  sessionId: string | undefined,
  sheet: WritingSheet,
): string {
  return sessionStatePath(sessionId, `writing-${sheet}-read`);
}
