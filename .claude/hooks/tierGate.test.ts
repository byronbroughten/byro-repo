import { execFileSync } from "node:child_process";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

const hookPath = fileURLToPath(new URL("./tierGate.ts", import.meta.url));
const projectDir = mkdtempSync(join(tmpdir(), "tier-gate-"));

function hookOutputOf(
  toolName: string,
  toolInput: Record<string, string>,
  isRunnerStep: boolean,
): unknown {
  const output = execFileSync("node", [hookPath], {
    cwd: projectDir,
    encoding: "utf8",
    env: {
      ...process.env,
      CLAUDE_PROJECT_DIR: projectDir,
      BYRO_RUNNER_STEP: isRunnerStep ? "1" : "",
    },
    input: JSON.stringify({
      hook_event_name: "PreToolUse",
      cwd: projectDir,
      tool_name: toolName,
      tool_input: toolInput,
    }),
  });
  return output === "" ? undefined : JSON.parse(output);
}

function decisionOf(output: unknown): unknown {
  return (output as { hookSpecificOutput?: { permissionDecision?: unknown } })
    ?.hookSpecificOutput?.permissionDecision;
}

describe("the tierGate hook on the web tools", () => {
  it.each([true, false])(
    "allows a documentation host's WebFetch and a WebSearch (runner step: %s)",
    (isRunnerStep) => {
      expect(
        decisionOf(
          hookOutputOf(
            "WebFetch",
            { url: "https://developers.google.com/sheets/api" },
            isRunnerStep,
          ),
        ),
      ).toBe("allow");
      expect(
        decisionOf(hookOutputOf("WebSearch", { query: "x" }, isRunnerStep)),
      ).toBe("allow");
    },
  );

  // No decision leaves the call to Claude Code, which asks in a session and refuses in a -p step that no PermissionRequest hook answers.
  it.each([true, false])(
    "decides nothing for another host's WebFetch (runner step: %s)",
    (isRunnerStep) => {
      expect(
        hookOutputOf(
          "WebFetch",
          { url: "https://example.com/?q=secret" },
          isRunnerStep,
        ),
      ).toBeUndefined();
    },
  );
});
