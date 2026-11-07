import { execFileSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { workspaceRm } from "./workspaceRm.ts";

let root: string;
let primaryRoot: string;
let workspaceFolder: string;
let workspace: string;

function git(cwd: string, ...args: string[]): string {
  return execFileSync(
    "git",
    ["-c", "user.name=Test", "-c", "user.email=test@example.com", ...args],
    { cwd, encoding: "utf8" },
  );
}

function committedRepo(path: string, files: string[]): void {
  mkdirSync(path, { recursive: true });
  git(path, "init", "-q", "-b", "master");
  files.forEach((file) => {
    mkdirSync(dirname(join(path, file)), { recursive: true });
    writeFileSync(join(path, file), `${file}\n`);
  });
  git(path, "add", ".");
  git(path, "commit", "-q", "-m", "files");
}

function stateOf(repo: string): string {
  return `${git(repo, "status", "--porcelain", "--untracked-files=all")}${git(repo, "ls-files")}`;
}

function rmOf(...paths: string[]) {
  return workspaceRm({ paths, cwd: workspace, primaryRoot, workspaceFolder });
}

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "ws-rm-"));
  primaryRoot = join(root, "primary");
  workspaceFolder = join(primaryRoot, ".claude", "worktrees");
  workspace = join(workspaceFolder, "issue-1");
  committedRepo(primaryRoot, [
    "a.txt",
    "b.txt",
    ".claude/hooks/hook.ts",
    "docs/c.md",
  ]);
  git(primaryRoot, "worktree", "add", "-q", "-b", "issue-1", workspace);
  writeFileSync(join(workspace, "untracked.txt"), "x\n");
});

afterEach(() => rmSync(root, { recursive: true, force: true }));

describe("a Workspace's tracked files", () => {
  it("deletes each through git rm, staged, .claude/hooks included", () => {
    const result = rmOf(
      "a.txt",
      ".claude/hooks/hook.ts",
      join(workspace, "docs/c.md"),
    );
    expect(result.refused).toEqual([]);
    ["a.txt", ".claude/hooks/hook.ts", "docs/c.md"].forEach((file) =>
      expect(existsSync(join(workspace, file))).toBe(false),
    );
    expect(git(workspace, "diff", "--cached", "--name-status")).toBe(
      "D\t.claude/hooks/hook.ts\nD\ta.txt\nD\tdocs/c.md\n",
    );
    expect(existsSync(join(primaryRoot, "a.txt"))).toBe(true);
  });

  it("deletes a tracked file in a package clone inside the Workspace", () => {
    const clone = join(workspace, "packages", "lib");
    committedRepo(clone, ["src/x.ts"]);
    const result = rmOf("packages/lib/src/x.ts");
    expect(result.refused).toEqual([]);
    expect(git(clone, "diff", "--cached", "--name-status")).toBe(
      "D\tsrc/x.ts\n",
    );
  });
});

describe("a refused path", () => {
  it.each([
    [() => join(primaryRoot, "a.txt"), "is in a Primary checkout"],
    [() => ".git/HEAD", "is under a `.git` folder"],
    [() => "docs/.git/x", "is under a `.git` folder"],
    [() => "untracked.txt", "isn't a file git tracks"],
    [() => "docs", "isn't a file git tracks"],
    [() => "missing.txt", "isn't a file git tracks"],
    [() => ".", "isn't a file git tracks"],
    [() => join(workspaceFolder, "stray.txt"), "isn't a file git tracks"],
    [() => join(root, "elsewhere.txt"), "is outside every Workspace"],
  ])("refuses %#, saying it %s, and deletes nothing", (pathOf, why) => {
    writeFileSync(join(root, "elsewhere.txt"), "x\n");
    const before = [stateOf(workspace), stateOf(primaryRoot)];
    const path = pathOf();
    const result = rmOf("b.txt", path);
    expect(result.refused).toEqual([{ path, why }]);
    expect(result.removed).toEqual([]);
    expect([stateOf(workspace), stateOf(primaryRoot)]).toEqual(before);
  });

  it("follows a symlinked folder to the Primary checkout it points into", () => {
    symlinkSync(primaryRoot, join(workspace, "link"));
    const before = stateOf(primaryRoot);
    expect(rmOf("link/a.txt").refused).toEqual([
      { path: "link/a.txt", why: "is in a Primary checkout" },
    ]);
    expect(stateOf(primaryRoot)).toBe(before);
  });

  it("refuses a file git rm would refuse, naming git's reason", () => {
    writeFileSync(join(workspace, "a.txt"), "changed\n");
    const before = stateOf(workspace);
    const [refusal] = rmOf("b.txt", "a.txt").refused;
    expect(refusal?.path).toBe("a.txt");
    expect(refusal?.why).toContain("local modifications");
    expect(stateOf(workspace)).toBe(before);
  });

  it("lists every refused path", () => {
    const result = rmOf(".git/HEAD", "untracked.txt", "a.txt");
    expect(result.refused.map(({ path }) => path)).toEqual([
      ".git/HEAD",
      "untracked.txt",
    ]);
    expect(existsSync(join(workspace, "a.txt"))).toBe(true);
  });
});
