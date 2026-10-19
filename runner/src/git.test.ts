import { mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { worktreeStateOf } from "./git.ts";
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
