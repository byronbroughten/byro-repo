import { describe, expect, it } from "vitest";

import { agentsCostContext, agentsCostReminder } from "./agentsCostNudge.ts";

const projectDir = "/repo";
function edit(
  filePath: string,
  hasReminded: boolean,
  cwd = projectDir,
): string | undefined {
  return agentsCostContext({ projectDir, cwd, filePath, hasReminded });
}

describe("agentsCostContext", () => {
  it("reminds on the first edit to the root AGENTS.md", () => {
    expect(edit("/repo/AGENTS.md", false)).toBe(agentsCostReminder);
  });

  it("resolves a relative path from the working directory", () => {
    expect(edit("AGENTS.md", false)).toBe(agentsCostReminder);
    expect(edit("../AGENTS.md", false, "/repo/docs")).toBe(agentsCostReminder);
  });

  it("reminds on the first edit to a workspace's root AGENTS.md", () => {
    expect(edit("/repo/.claude/worktrees/agent-1/AGENTS.md", false)).toBe(
      agentsCostReminder,
    );
    expect(
      edit("/repo/.claude/worktrees/agent-1/docs/AGENTS.md", false),
    ).toBeUndefined();
  });

  it("stays quiet once the session has been reminded", () => {
    expect(edit("/repo/AGENTS.md", true)).toBeUndefined();
  });

  it("leaves nested AGENTS.md files alone", () => {
    expect(
      edit("/repo/packages/framework/src/AGENTS.md", false),
    ).toBeUndefined();
    expect(edit("/repo/scripts/AGENTS.md", false)).toBeUndefined();
  });

  it("leaves other files and other repos alone", () => {
    expect(edit("/repo/CLAUDE.md", false)).toBeUndefined();
    expect(edit("/repo/docs/agents/prose-files.md", false)).toBeUndefined();
    expect(edit("/elsewhere/AGENTS.md", false)).toBeUndefined();
  });

  it("names the section to read", () => {
    expect(agentsCostReminder).toMatch(/docs\/agents\/prose-files\.md/);
    expect(agentsCostReminder).toMatch(/What an addition to AGENTS\.md costs/);
  });
});
