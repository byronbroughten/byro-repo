import { describe, expect, it } from "vitest";

import {
  editDecision,
  isProseBashRead,
  isProseRead,
  proseGateReason,
} from "./proseGate.ts";
import type { EditDecision } from "./styleGate.ts";

const projectDir = "/repo";
function edit(
  filePath: string,
  hasReadProse: boolean,
  cwd = projectDir,
): EditDecision {
  return editDecision({ projectDir, cwd, filePath, hasReadProse });
}

describe("editDecision", () => {
  it("denies a markdown edit before docs/prose-style.md was read", () => {
    expect(edit("/repo/AGENTS.md", false)).toEqual({
      denyReason: proseGateReason,
    });
    expect(edit("/repo/.claude/skills/tdd/SKILL.md", false)).toEqual({
      denyReason: proseGateReason,
    });
    expect(edit("/repo/packages/framework/README.md", false)).toEqual({
      denyReason: proseGateReason,
    });
    expect(edit("/repo/docs/adr/0011-x.md", false)).toEqual({
      denyReason: proseGateReason,
    });
  });

  it("judges a relative path from the working directory against the project root", () => {
    expect(edit("AGENTS.md", false, "/repo/packages/framework/src")).toEqual({
      denyReason: proseGateReason,
    });
    expect(
      edit("../writing/pieces/a.md", false, "/repo/packages/framework"),
    ).toEqual({
      denyReason: undefined,
    });
  });

  it("allows a markdown edit after docs/prose-style.md was read", () => {
    expect(edit("/repo/AGENTS.md", true)).toEqual({ denyReason: undefined });
  });

  it("allows edits under the writing package and the outcome records folder", () => {
    expect(edit("/repo/packages/writing/pieces/a.md", false)).toEqual({
      denyReason: undefined,
    });
    expect(
      edit("/repo/docs/agents/outcomes/byro-repo-382/byro-repo-384.md", false),
    ).toEqual({ denyReason: undefined });
  });

  it("allows non-markdown edits", () => {
    expect(edit("/repo/scripts/docLint.ts", false)).toEqual({
      denyReason: undefined,
    });
    expect(edit("/repo/package.json", false)).toEqual({
      denyReason: undefined,
    });
  });

  it("allows markdown outside the project or in untracked folders", () => {
    expect(edit("/elsewhere/AGENTS.md", false)).toEqual({
      denyReason: undefined,
    });
    expect(edit("/repo/node_modules/x/README.md", false)).toEqual({
      denyReason: undefined,
    });
    expect(edit("/repo/.claude/worktrees/agent-1/AGENTS.md", false)).toEqual({
      denyReason: undefined,
    });
  });
});

describe("the refusal reason", () => {
  it("names the file, asks for a full read, and says when to skip the reasoning folder", () => {
    expect(proseGateReason).toMatch(/docs\/prose-style\.md/);
    expect(proseGateReason).toMatch(/full Read/);
    expect(proseGateReason).toMatch(/partial/);
    expect(proseGateReason).toMatch(/docs\/prose-style\//);
    expect(proseGateReason).toMatch(/retry/);
  });
});

describe("isProseRead", () => {
  function read(
    filePath: string,
    bounds: { offset?: number; limit?: number } = {},
  ): boolean {
    return isProseRead({
      projectDir,
      cwd: projectDir,
      filePath,
      totalLines: 52,
      ...bounds,
    });
  }

  it("is true for a full Read of docs/prose-style.md", () => {
    expect(read("/repo/docs/prose-style.md")).toBe(true);
    expect(read("/repo/docs/prose-style.md", { offset: 1, limit: 2000 })).toBe(
      true,
    );
  });

  it("is false for a partial Read", () => {
    expect(read("/repo/docs/prose-style.md", { limit: 10 })).toBe(false);
    expect(read("/repo/docs/prose-style.md", { offset: 20 })).toBe(false);
  });

  it("is false for a reasoning file or another doc", () => {
    expect(read("/repo/docs/prose-style/smells.md")).toBe(false);
    expect(read("/repo/config/docs/code-style.md")).toBe(false);
  });
});

describe("isProseBashRead", () => {
  it("counts a whole-file read of docs/prose-style.md", () => {
    expect(
      isProseBashRead(projectDir, [
        "/repo/AGENTS.md",
        "/repo/docs/prose-style.md",
      ]),
    ).toBe(true);
  });

  it("ignores a read of any other doc", () => {
    expect(
      isProseBashRead(projectDir, ["/repo/docs/prose-style/smells.md"]),
    ).toBe(false);
  });
});
