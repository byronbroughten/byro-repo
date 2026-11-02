import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

import { describe, expect, it } from "vitest";

import { BashReads, largeFileLines } from "./bashReads.ts";

const bigFile = "line\n".repeat(largeFileLines + 1);

function projectWith(files: Record<string, string>): string {
  const projectDir = mkdtempSync(join(tmpdir(), "bash-reads-"));
  for (const [path, content] of Object.entries(files)) {
    mkdirSync(dirname(join(projectDir, path)), { recursive: true });
    writeFileSync(join(projectDir, path), content);
  }
  return projectDir;
}

function denyReasonOf(projectDir: string, command: string): string | undefined {
  return BashReads.init({ command, cwd: projectDir }).classify().denyReason;
}

describe("BashReads unguarded folders", () => {
  const projectDir = projectWith({
    "src/big.ts": bigFile,
    ".probe/last.json": bigFile,
    "dev/.probe/last.json": bigFile,
    "packages/framework/dist/bundle.js": bigFile,
    "packages/app/coverage/index.html": bigFile,
  });

  it("guards a large repo file", () => {
    expect(denyReasonOf(projectDir, "cat src/big.ts")).toMatch(
      /would dump all/,
    );
  });

  it("exempts .probe, dist and coverage at the root and at any depth", () => {
    expect(denyReasonOf(projectDir, "cat .probe/last.json")).toBeUndefined();
    expect(
      denyReasonOf(projectDir, "cat dev/.probe/last.json"),
    ).toBeUndefined();
    expect(
      denyReasonOf(projectDir, "cat packages/framework/dist/bundle.js"),
    ).toBeUndefined();
    expect(
      denyReasonOf(projectDir, "cat packages/app/coverage/index.html"),
    ).toBeUndefined();
  });

  it("still guards a large file after a cd inside a loop, conditional, group, subshell or function", () => {
    [
      "if c; then cd /elsewhere; fi; cat src/big.ts",
      "{ cd /elsewhere; }; cat src/big.ts",
      "(cd /elsewhere); cat src/big.ts",
      "for d in a; do cd /elsewhere; done; cat src/big.ts",
      "e(){ cd /elsewhere; }; e; cat src/big.ts",
      "! cd /elsewhere && cat src/big.ts",
    ].forEach((command) =>
      expect(denyReasonOf(projectDir, command)).toMatch(/would dump all/),
    );
  });

  it("guards a large file read inside one", () => {
    [
      "for f in a; do cat src/big.ts; done",
      "if c; then cat src/big.ts; fi",
      "r(){ cat $1; }; r src/big.ts",
    ].forEach((command) =>
      expect(denyReasonOf(projectDir, command)).toMatch(/would dump all/),
    );
  });

  it("does not exempt a file merely named like an unguarded folder", () => {
    const withNamedFile = projectWith({ "src/dist": bigFile });
    expect(denyReasonOf(withNamedFile, "cat src/dist")).toMatch(
      /would dump all/,
    );
  });
});

describe("BashReads columnConfigs", () => {
  const projectDir = projectWith({
    "packages/real-estate/sheets.config.json": JSON.stringify({
      spreadsheetId: "app-id",
      generatedDir: "src/generated",
      choreHomes: [],
    }),
    "packages/framework/sheets.config.json": JSON.stringify({
      spreadsheetId: "dev-id",
      generatedDir: "dev/generated",
      choreHomes: [],
    }),
    "packages/real-estate/src/generated/columnConfigs.ts": "small\n",
    "packages/framework/dev/generated/columnConfigs.ts": "small\n",
  });

  it("denies a long ranged read of a workspace's columnConfigs.ts", () => {
    expect(
      denyReasonOf(
        projectDir,
        "sed -n '1,400p' .claude/worktrees/agent-1/packages/real-estate/src/generated/columnConfigs.ts",
      ),
    ).toMatch(/columnConfigs\.ts beyond one block/);
  });

  it("denies a whole read of every package's columnConfigs.ts, found through its generatedDir", () => {
    expect(
      denyReasonOf(
        projectDir,
        "cat packages/real-estate/src/generated/columnConfigs.ts",
      ),
    ).toMatch(/columnConfigs\.ts beyond one block/);
    expect(
      denyReasonOf(
        projectDir,
        "cat packages/framework/dev/generated/columnConfigs.ts",
      ),
    ).toMatch(/columnConfigs\.ts beyond one block/);
  });

  it("allows one block of it", () => {
    expect(
      denyReasonOf(
        projectDir,
        "sed -n '1,40p' packages/framework/dev/generated/columnConfigs.ts",
      ),
    ).toBeUndefined();
  });
});

describe("BashReads.wholeFilePaths", () => {
  function wholeFilePathsOf(command: string, cwd = "/repo"): string[] {
    return BashReads.init({ command, cwd }).wholeFilePaths();
  }

  it("lists every file a cat prints, resolved from the working directory", () => {
    expect(wholeFilePathsOf("cat a.md docs/b.md")).toEqual([
      "/repo/a.md",
      "/repo/docs/b.md",
    ]);
  });

  it("follows a cd earlier in the command", () => {
    expect(
      wholeFilePathsOf("cd /repo/config && cat docs/code-style.md"),
    ).toEqual(["/repo/config/docs/code-style.md"]);
  });

  it("resolves a file from the folder before and after a cd that may not run", () => {
    expect(
      wholeFilePathsOf("if c; then cd /repo/config; fi; cat a.md"),
    ).toEqual(["/repo/a.md", "/repo/config/a.md"]);
  });

  it("leaves out a cat whose output a pipe trims", () => {
    expect(wholeFilePathsOf("cat a.md | head -5")).toEqual([]);
  });

  it("leaves out ranges and filters", () => {
    expect(
      wholeFilePathsOf("sed -n 1,20p a.md; grep x a.md; head -5 a.md"),
    ).toEqual([]);
  });
});
