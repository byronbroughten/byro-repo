// The PermissionRequest hook ClaudeAgentStep registers on every step; its one argument is the JSON of SkillWriteHookArgs.
// It prints an allow when skillWriteDecision() allows and nothing otherwise, an error included, so the prompt is denied.
import { readFileSync } from "node:fs";

import {
  skillWriteDecision,
  type SkillWriteRequest,
} from "./skillWriteDecision.ts";

export type SkillWriteHookArgs = Pick<
  SkillWriteRequest,
  "workspaceRoot" | "allowedGlobs"
>;

try {
  const args = JSON.parse(process.argv[2] ?? "") as SkillWriteHookArgs;
  const input = JSON.parse(readFileSync(0, "utf8")) as {
    tool_name?: unknown;
    tool_input?: unknown;
  };
  const decision = skillWriteDecision({
    toolName: String(input.tool_name),
    toolInput: (input.tool_input ?? {}) as SkillWriteRequest["toolInput"],
    ...args,
  });
  if (decision === "allow") {
    process.stdout.write(
      JSON.stringify({
        hookSpecificOutput: {
          hookEventName: "PermissionRequest",
          decision: { behavior: "allow" },
        },
      }),
    );
  }
} catch {
  // No decision: the run's own permission handling denies the prompt.
}
