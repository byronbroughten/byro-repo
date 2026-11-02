import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

const hookPath = fileURLToPath(new URL("./stepPermission.ts", import.meta.url));
const workspaceRoot = mkdtempSync(join(tmpdir(), "step-permission-"));
mkdirSync(join(workspaceRoot, ".vscode"));
// Outside both the workspace and $TMPDIR, which a step may also write.
symlinkSync("/usr", join(workspaceRoot, "escape"));

const allowed = {
  hookSpecificOutput: {
    hookEventName: "PermissionRequest",
    decision: { behavior: "allow" },
  },
};

// A project whose settings turn the sandbox on, with unsandboxed commands off.
const sandboxedRoot = mkdtempSync(join(tmpdir(), "step-permission-on-"));
mkdirSync(join(sandboxedRoot, ".claude"));
writeFileSync(
  join(sandboxedRoot, ".claude", "settings.json"),
  JSON.stringify({
    sandbox: { enabled: true, allowUnsandboxedCommands: false },
  }),
);
// No user settings layer, so the sandbox state is only what the project folder says.
const emptyConfigDir = mkdtempSync(join(tmpdir(), "step-permission-config-"));

function hookOutputOf(
  toolName: string,
  toolInput: Record<string, string>,
  isRunnerStep = true,
  projectDir = workspaceRoot,
): unknown {
  const { BYRO_GATE_ROOT: _gateRoot, ...inheritedEnv } = process.env;
  const output = execFileSync("node", [hookPath], {
    cwd: projectDir,
    encoding: "utf8",
    env: {
      ...inheritedEnv,
      CLAUDE_CONFIG_DIR: emptyConfigDir,
      CLAUDE_PROJECT_DIR: projectDir,
      BYRO_RUNNER_STEP: isRunnerStep ? "1" : "",
    },
    input: JSON.stringify({
      hook_event_name: "PermissionRequest",
      cwd: projectDir,
      tool_name: toolName,
      tool_input: toolInput,
    }),
  });
  return output === "" ? undefined : JSON.parse(output);
}

describe("the stepPermission hook", () => {
  it("allows a runner step's Edit and Bash write to a protected path in its workspace", () => {
    const path = join(workspaceRoot, ".vscode/settings.json");
    expect(hookOutputOf("Edit", { file_path: path })).toEqual(allowed);
    // With the sandbox off, the gate asks for a redirect, so this write is freed by the sandbox on.
    expect(
      hookOutputOf(
        "Bash",
        { command: `echo x > ${path}` },
        true,
        sandboxedRoot,
      ),
    ).toEqual(allowed);
  });

  it("decides nothing for a write through a symlink out of the workspace", () => {
    const path = join(workspaceRoot, "escape/x");
    expect(hookOutputOf("Write", { file_path: path })).toBeUndefined();
    expect(hookOutputOf("Bash", { command: `rm ${path}` })).toBeUndefined();
  });

  it("allows a Bash call the project's sandbox runs, and decides nothing with the sandbox off", () => {
    const toolInput = { command: 'node -e "console.log(1)"' };
    expect(hookOutputOf("Bash", toolInput, true, sandboxedRoot)).toEqual(
      allowed,
    );
    expect(hookOutputOf("Bash", toolInput)).toBeUndefined();
  });

  it("decides nothing outside a runner step", () => {
    const path = join(workspaceRoot, ".vscode/settings.json");
    expect(hookOutputOf("Edit", { file_path: path }, false)).toBeUndefined();
  });
});
