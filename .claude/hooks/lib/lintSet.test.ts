import { describe, expect, it } from "vitest";

import { isInLintSet, rootOf } from "./lintSet.ts";

const projectDir = "/repo";
const generatedDirs = [
  "packages/real-estate/src/generated",
  "packages/framework/dev/generated",
];
function inSet(filePath: string, cwd = projectDir): boolean {
  return isInLintSet({ projectDir, cwd, filePath, generatedDirs });
}

describe("isInLintSet", () => {
  it("includes a package source file, a hook and a tool config", () => {
    expect(
      inSet("/repo/packages/framework/src/02_SpreadsheetRaw/SheetRaw.ts"),
    ).toBe(true);
    expect(inSet("/repo/.claude/hooks/lib/lintFeedback.ts")).toBe(true);
    expect(inSet("/repo/eslint.config.mjs")).toBe(true);
  });

  it("resolves a relative path from the working directory", () => {
    expect(
      inSet("SheetRaw.ts", "/repo/packages/framework/src/02_SpreadsheetRaw"),
    ).toBe(true);
  });

  it("excludes each package's generated configs", () => {
    expect(
      inSet("/repo/packages/real-estate/src/generated/sheetConfigs.ts"),
    ).toBe(false);
    expect(
      inSet("/repo/packages/framework/dev/generated/sheetConfigs.ts"),
    ).toBe(false);
  });

  it("excludes built output, dependencies and paths outside the project", () => {
    expect(inSet("/repo/packages/framework/dist/bundle.js")).toBe(false);
    expect(inSet("/repo/node_modules/x/index.js")).toBe(false);
    expect(inSet("/elsewhere/packages/framework/src/x.ts")).toBe(false);
  });

  it("judges a workspace file as its own root's", () => {
    expect(inSet("/repo/.claude/worktrees/agent-1/scripts/docLint.ts")).toBe(
      true,
    );
    expect(
      inSet(
        "/repo/.claude/worktrees/agent-1/packages/real-estate/src/generated/sheetConfigs.ts",
      ),
    ).toBe(false);
    expect(
      inSet("/repo/.claude/worktrees/agent-1/node_modules/x/index.js"),
    ).toBe(false);
  });

  it("excludes files ESLint doesn't lint", () => {
    expect(inSet("/repo/packages/framework/src/AGENTS.md")).toBe(false);
    expect(inSet("/repo/packages/framework/sheets.config.json")).toBe(false);
  });
});

describe("rootOf", () => {
  function rootOfFile(filePath: string, cwd = projectDir): string {
    return rootOf({ projectDir, cwd, filePath });
  }

  it("is the project for a primary file", () => {
    expect(rootOfFile("/repo/packages/framework/src/x.ts")).toBe("/repo");
    expect(rootOfFile("AGENTS.md")).toBe("/repo");
  });

  it("is the workspace for a file at a workspace's root", () => {
    expect(rootOfFile("/repo/.claude/worktrees/agent-1/AGENTS.md")).toBe(
      "/repo/.claude/worktrees/agent-1",
    );
  });

  it("is the workspace, not the clone, for a file in a workspace's package clone", () => {
    expect(
      rootOfFile(
        "src/x.ts",
        "/repo/.claude/worktrees/agent-1/packages/framework",
      ),
    ).toBe("/repo/.claude/worktrees/agent-1");
  });
});
