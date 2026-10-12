// PreToolUse on Edit and Write: the first edit to the root AGENTS.md in a session carries a reminder of what growing that file costs. Never blocks.
import { existsSync, writeFileSync } from "node:fs";

import { agentsCostContext } from "./lib/agentsCostNudge.ts";
import {
  readHookInput,
  runFailOpen,
  sessionStatePath,
  writeHookOutput,
} from "./lib/hookIo.ts";

await runFailOpen(() => {
  const input = readHookInput();
  if (!input) return;
  const filePath = input.tool_input?.file_path;
  if (
    !["Edit", "Write"].includes(input.tool_name ?? "") ||
    typeof filePath !== "string"
  ) {
    return;
  }
  const projectDir =
    process.env.CLAUDE_PROJECT_DIR ?? input.cwd ?? process.cwd();
  const markerPath = sessionStatePath(input.session_id, "agents-cost");
  const context = agentsCostContext({
    projectDir,
    cwd: input.cwd ?? projectDir,
    filePath,
    hasReminded: existsSync(markerPath),
  });
  if (!context) return;
  writeFileSync(markerPath, "");
  writeHookOutput({
    hookSpecificOutput: {
      hookEventName: "PreToolUse",
      additionalContext: context,
    },
  });
});
