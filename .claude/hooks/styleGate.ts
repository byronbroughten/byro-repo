// PostToolUse on Read records a full read of config/docs/code-style.md; PreToolUse on Edit and Write denies a gated code edit until one is recorded.
import { existsSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { lineCount, readHookInput, runFailOpen, sessionStatePath, writeHookOutput } from "./lib/hookIo.ts";
import { readSheetsConfigs } from "./lib/sheetsConfigs.ts";
import { editDecision, isPostToolUse, isStyleRead, stylePath } from "./lib/styleGate.ts";

await runFailOpen(() => {
  const input = readHookInput();
  if (!input) return;
  const filePath = input.tool_input?.file_path ?? input.tool_input?.path;
  if (typeof filePath !== "string") return;
  const projectDir = process.env.CLAUDE_PROJECT_DIR ?? input.workspace_roots?.[0] ?? input.cwd ?? process.cwd();
  const where = { projectDir, cwd: input.cwd ?? projectDir, filePath };
  const markerPath = sessionStatePath(input.session_id ?? input.conversation_id, "style-read");
  if (isPostToolUse(input.hook_event_name)) {
    if (input.tool_name !== "Read") return;
    const { offset, limit } = input.tool_input ?? {};
    if (isStyleRead({ ...where, offset, limit, totalLines: lineCount(join(projectDir, stylePath)) })) {
      writeFileSync(markerPath, "");
    }
    return;
  }
  if (!["Edit", "Write"].includes(input.tool_name ?? "")) return;
  const { denyReason } = editDecision({
    ...where,
    hasReadStyle: existsSync(markerPath),
    generatedDirs: readSheetsConfigs(projectDir).map(({ generatedDir }) => generatedDir),
  });
  if (!denyReason) return;
  writeHookOutput({
    hookSpecificOutput: {
      hookEventName: "PreToolUse",
      permissionDecision: "deny",
      permissionDecisionReason: denyReason,
    },
  });
});
