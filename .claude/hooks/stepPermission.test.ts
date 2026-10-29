import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, symlinkSync } from "node:fs";
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

function hookOutputOf(
  toolName: string,
  toolInput: Record<string, string>,
  isRunnerStep = true,
): unknown {
  const output = execFileSync("node", [hookPath], {
    cwd: workspaceRoot,
    encoding: "utf8",
    env: {
      ...process.env,
      CLAUDE_PROJECT_DIR: workspaceRoot,
      BYRO_RUNNER_STEP: isRunnerStep ? "1" : "",
    },
    input: JSON.stringify({
      hook_event_name: "PermissionRequest",
      cwd: workspaceRoot,
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
    expect(hookOutputOf("Bash", { command: `echo x > ${path}` })).toEqual(
      allowed,
    );
  });

  it("decides nothing for a write through a symlink out of the workspace", () => {
    const path = join(workspaceRoot, "escape/x");
    expect(hookOutputOf("Write", { file_path: path })).toBeUndefined();
    expect(hookOutputOf("Bash", { command: `rm ${path}` })).toBeUndefined();
  });

  it("decides nothing outside a runner step", () => {
    const path = join(workspaceRoot, ".vscode/settings.json");
    expect(hookOutputOf("Edit", { file_path: path }, false)).toBeUndefined();
  });
});
