import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

const hookPath = fileURLToPath(new URL("./tierGate.ts", import.meta.url));
const projectDir = mkdtempSync(join(tmpdir(), "tier-gate-"));
const homeDir = mkdtempSync(join(tmpdir(), "tier-gate-home-"));

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
      // The developer's own user settings stay out of the gate's sandbox state.
      HOME: homeDir,
      CLAUDE_CONFIG_DIR: join(homeDir, ".claude"),
      CLAUDE_PROJECT_DIR: projectDir,
      BYRO_GATE_ROOT: projectDir,
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

function writeSettings(folder: string, content: string): void {
  mkdirSync(join(folder, ".claude"), { recursive: true });
  writeFileSync(join(folder, ".claude", "settings.json"), content);
}

function projectSandbox(sandbox: Record<string, unknown>): void {
  writeSettings(
    projectDir,
    JSON.stringify({ sandbox: { ...sandbox, excludedCommands: ["npm test"] } }),
  );
}

function boxedCallDecision(): unknown {
  return decisionOf(
    hookOutputOf("Bash", { command: "cd . && npm test" }, false),
  );
}

describe("the tierGate hook on an excluded command", () => {
  it("refuses one the call keeps in the box, by the session's sandbox state", () => {
    projectSandbox({ enabled: true, allowUnsandboxedCommands: false });
    expect(boxedCallDecision()).toBe("deny");
  });

  it("refuses nothing when the sandbox is disabled", () => {
    projectSandbox({ enabled: false });
    expect(boxedCallDecision()).not.toBe("deny");
  });

  it("asks for it, not refuses, with a user settings file that doesn't parse", () => {
    projectSandbox({ enabled: true, allowUnsandboxedCommands: false });
    writeSettings(homeDir, "{ not json");
    try {
      expect(boxedCallDecision()).toBe("ask");
    } finally {
      writeSettings(homeDir, "{}");
    }
  });
});
