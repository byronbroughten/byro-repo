import { mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, relative } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { currentBranchOf, worktreeStateOf } from "./git.ts";
import { git } from "./GitFixture.ts";

let repo: string;

beforeEach(() => {
  repo = realpathSync(mkdtempSync(join(tmpdir(), "worktree-state-")));
  git(repo, "init", "-b", "master");
  git(repo, "config", "user.name", "Test");
  git(repo, "config", "user.email", "test@example.com");
  writeFileSync(join(repo, "README.md"), "# repo\n");
  git(repo, "add", ".");
  git(repo, "commit", "-m", "Initial commit");
});

afterEach(() => {
  rmSync(repo, { recursive: true, force: true });
});

describe("worktreeStateOf", () => {
  it("reads a clean tree's branch and head", async () => {
    expect(await worktreeStateOf(repo)).toEqual({
      branch: "master",
      head: git(repo, "rev-parse", "HEAD"),
      isDirty: false,
    });
  });

  it("reads a tree whose only change is an untracked file as dirty", async () => {
    writeFileSync(join(repo, "new.txt"), "untracked");

    expect(await worktreeStateOf(repo)).toMatchObject({ isDirty: true });
  });

  it("reads a detached HEAD as no branch, with its head still set", async () => {
    git(repo, "switch", "--detach", "master");

    expect(await worktreeStateOf(repo)).toEqual({
      branch: "",
      head: git(repo, "rev-parse", "HEAD"),
      isDirty: false,
    });
  });
});

describe("currentBranchOf", () => {
  it("reads a primary checkout's branch", async () => {
    git(repo, "switch", "-c", "feature");

    expect(await currentBranchOf(repo)).toBe("feature");
  });

  it("reads a detached HEAD as no branch", async () => {
    git(repo, "switch", "--detach", "master");

    expect(await currentBranchOf(repo)).toBe("");
  });

  it("reads a branch with no commits yet", async () => {
    git(repo, "switch", "--orphan", "fresh");

    expect(await currentBranchOf(repo)).toBe("fresh");
  });

  it("reads a workspace's checkout apart from its primary checkout", async () => {
    const workspace = `${repo}-workspace`;
    git(repo, "worktree", "add", "-b", "issue-1", workspace);

    try {
      expect(await currentBranchOf(workspace)).toBe("issue-1");
      expect(await currentBranchOf(repo)).toBe("master");
    } finally {
      rmSync(workspace, { recursive: true, force: true });
    }
  });

  it("follows a .git file whose git folder is relative to the checkout", async () => {
    const workspace = `${repo}-workspace`;
    git(repo, "worktree", "add", "-b", "issue-1", workspace);
    const gitDir = git(workspace, "rev-parse", "--git-dir");
    writeFileSync(
      join(workspace, ".git"),
      `gitdir: ${relative(workspace, gitDir)}\n`,
    );

    try {
      expect(await currentBranchOf(workspace)).toBe("issue-1");
    } finally {
      rmSync(workspace, { recursive: true, force: true });
    }
  });
});
