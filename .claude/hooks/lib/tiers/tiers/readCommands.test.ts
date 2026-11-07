import { describe, expect, it } from "vitest";

import { gateDecision, type SessionMode } from "../tiers.ts";

const entries = ["ps", "ps *", "pgrep", "pgrep *"];

function decisionOf(command: string, mode: SessionMode = "interactive") {
  return gateDecision({
    command,
    mode,
    dryRuns: [],
    sandbox: { isOn: true, excludedCommands: entries },
  });
}

describe("`ps` and `pgrep`", () => {
  it.each([
    ["ps", "interactive"],
    ["ps aux", "interactive"],
    ["pgrep -fl vitest", "interactive"],
    ["pgrep", "runnerStep"],
    ["ps -p 123 -o pid,command", "runnerStep"],
  ] as const)("frees `%s` in an %s session", (command, mode) => {
    const decision = decisionOf(command, mode);
    expect(decision?.permissionDecision).toBe("allow");
    expect(decision?.reason).toContain("only reads the process list");
  });

  it.each([
    ["ps aux | grep node", "`ps`"],
    ["pgrep node | head", "`pgrep`"],
  ])("refuses `%s`, kept in the box, which can't run %s", (command, name) => {
    const decision = decisionOf(command);
    expect(decision?.permissionDecision).toBe("deny");
    expect(decision?.reason).toContain(`the sandbox can't run ${name}`);
  });
});
