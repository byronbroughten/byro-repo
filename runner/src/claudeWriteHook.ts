// The PermissionRequest hook ClaudeAgentStep registers on every step; its one argument is the JSON of ClaudeWriteHookArgs.
import { readFileSync } from "node:fs";

import {
  claudeWriteDecision,
  type ClaudeWriteRequest,
  type ClaudeWriteToolInput,
} from "./claudeWriteDecision.ts";

export type ClaudeWriteHookArgs = Pick<
  ClaudeWriteRequest,
  "workspaceRoot" | "allowedGlobs"
>;

try {
  const args = JSON.parse(process.argv[2] ?? "") as ClaudeWriteHookArgs;
  const input = JSON.parse(readFileSync(0, "utf8")) as {
    tool_name?: unknown;
    tool_input?: unknown;
  };
  const decision = claudeWriteDecision({
    toolName: String(input.tool_name),
    toolInput: (input.tool_input ?? {}) as ClaudeWriteToolInput,
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
