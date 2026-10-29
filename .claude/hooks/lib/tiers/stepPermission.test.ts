import { describe, expect, it } from "vitest";

import { fakePlaces } from "./fakePlaces.ts";
import {
  type PermissionCall,
  stepPermissionDecision,
} from "./stepPermission.ts";

function call(
  toolName: string,
  toolInput: PermissionCall["toolInput"],
  mode: PermissionCall["mode"] = "runnerStep",
): PermissionCall {
  return { toolName, toolInput, mode, dryRuns: [], places: fakePlaces() };
}

// Each path through an Edit, a Write, an `mv` and a redirect, which must all get the one answer.
function answersFor(path: string): (string | undefined)[] {
  return [
    stepPermissionDecision(call("Edit", { file_path: path })),
    stepPermissionDecision(call("Write", { file_path: path })),
    stepPermissionDecision(
      call("Bash", { command: `mv /tmp/helper.mjs ${path}` }),
    ),
    stepPermissionDecision(call("Bash", { command: `echo x > ${path}` })),
  ];
}

describe("stepPermissionDecision", () => {
  it.each([
    "/ws/.claude/settings.json",
    "/ws/.claude/skills/tdd/SKILL.md",
    "/ws/.vscode/settings.json",
    "/ws/.mcp.json",
    "/ws/.githooks/pre-commit",
    "/tmp/out.txt",
  ])("allows %s through an Edit and a Bash write alike", (path) => {
    expect(answersFor(path)).toEqual(["allow", "allow", "allow", "allow"]);
  });

  it.each([
    "/ws/.git/config",
    "/ws/packages/framework/.git/config",
    "/outside/x",
    "/ws/escape/x",
    "/ws/dangling",
    "/Users/dev/.claude/settings.json",
  ])("decides nothing for %s through an Edit or a Bash write", (path) => {
    expect(answersFor(path)).toEqual([
      undefined,
      undefined,
      undefined,
      undefined,
    ]);
  });

  it("decides nothing for a Bash call the gate doesn't allow", () => {
    ["git push", "node /ws/scripts/tool.ts", "curl https://x"].forEach(
      (command) =>
        expect(
          stepPermissionDecision(call("Bash", { command })),
        ).toBeUndefined(),
    );
  });

  it("allows a Read outside the workspace", () => {
    expect(
      stepPermissionDecision(call("Read", { file_path: "/outside/x" })),
    ).toBe("allow");
  });

  it("decides nothing for another tool or an input with no path or command", () => {
    [
      call("NotebookEdit", { notebook_path: "/ws/a.ipynb" }),
      call("WebFetch", {}),
      call("constructor", { file_path: "/ws/a.ts" }),
      call("Edit", {}),
      call("Bash", {}),
    ].forEach((request) =>
      expect(stepPermissionDecision(request)).toBeUndefined(),
    );
  });

  it("decides nothing outside a runner step", () => {
    [
      call("Edit", { file_path: "/ws/.vscode/settings.json" }, "interactive"),
      call("Bash", { command: "echo x > /ws/.mcp.json" }, "interactive"),
      call("Read", { file_path: "/outside/x" }, "interactive"),
    ].forEach((request) =>
      expect(stepPermissionDecision(request)).toBeUndefined(),
    );
  });
});
