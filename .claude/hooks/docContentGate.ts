// PostToolUse on Read records a full read of docs/writing-style.md; PreToolUse on the gworkspace Doc writes denies a text write until one is recorded.
import { existsSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { docWriteDecision, isWritingStyleRead, writingStylePath } from "./lib/docContentGate.ts";
import { lineCount, readHookInput, runFailOpen, sessionStatePath, writeDenyOutput } from "./lib/hookIo.ts";
import { isPostToolUse } from "./lib/styleGate.ts";

await runFailOpen(() => {
  const input = readHookInput();
  if (!input) return;
  const markerPath = sessionStatePath(input.session_id ?? input.conversation_id, "writing-style-read");
  if (isPostToolUse(input.hook_event_name)) {
    const filePath = input.tool_input?.file_path;
    if (input.tool_name !== "Read" || typeof filePath !== "string") return;
    const projectDir = process.env.CLAUDE_PROJECT_DIR ?? input.cwd ?? process.cwd();
    const { offset, limit } = input.tool_input ?? {};
    const totalLines = lineCount(join(projectDir, writingStylePath));
    if (isWritingStyleRead({ projectDir, cwd: input.cwd ?? projectDir, filePath, offset, limit, totalLines })) {
      writeFileSync(markerPath, "");
    }
    return;
  }
  const { denyReason } = docWriteDecision({
    toolName: input.tool_name,
    toolInput: input.tool_input,
    hasReadWritingStyle: existsSync(markerPath),
  });
  if (!denyReason) return;
  writeDenyOutput(denyReason);
});
