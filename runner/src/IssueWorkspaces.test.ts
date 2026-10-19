import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { git } from "./GitFixture.ts";
import {
  advanceMaster,
  branchOf,
  installs,
  primaryRoot,
  primaryStates,
  registeredWorktrees,
  temp,
  titleLookups,
  useIssueWorkspacesHarness,
  workspaces,
} from "./issueWorkspacesHarness.ts";

useIssueWorkspacesHarness();

describe("create", () => {
  it("puts the issue's repo on the issue branch and detaches every other repo at master", async () => {
    const before = primaryStates();
    const workspace = await workspaces().create({
      repo: "sheets-framework",
      number: 48,
    });

    const root = join(
      temp,
      "workspaces/sheets-framework-issue-48-workspace-module-create-list-and-remove",
    );
    expect(workspace.path).toBe(root);
    expect(branchOf(join(root, "packages/framework"))).toBe(
      "issue-48-workspace-module-create-list-and-remove",
    );
    expect(branchOf(root)).toBeUndefined();
    expect(branchOf(join(root, "packages/utils"))).toBeUndefined();
    expect(git(root, "rev-parse", "HEAD")).toBe(
      git(primaryRoot, "rev-parse", "master"),
    );
    expect(workspace.branchedRepos).toEqual(["sheets-framework"]);
    expect(primaryStates()).toEqual(before);
  });
});

describe("start", () => {
  it("creates a workspace that doesn't exist, for either key", async () => {
    const issue = await workspaces().start({ repo: "byro-repo", number: 7 });
    const session = await workspaces().start({ session: "glossary-fix" });

    expect(issue.branch).toBe(
      "issue-7-workspace-module-create-list-and-remove",
    );
    expect(branchOf(issue.path)).toBe(issue.branch);
    expect(session.branch).toBe("session-glossary-fix");
    expect(installs).toEqual([issue.path, session.path]);
  });

  it("gives an issue workspace the branch create would", async () => {
    const started = await workspaces().start({ repo: "utils", number: 48 });
    await workspaces().remove(started);
    git(join(primaryRoot, "packages/utils"), "branch", "-D", started.branch);

    const created = await workspaces().create({ repo: "utils", number: 48 });

    expect(started.branch).toBe(created.branch);
    expect(started.path).toBe(created.path);
  });

  it("resumes an existing issue workspace, moving its detached repos to master", async () => {
    const created = await workspaces().create(
      { repo: "byro-repo", number: 7 },
      { slug: "spans" },
    );
    const newerUtils = advanceMaster("packages/utils", "newer.txt");

    const started = await workspaces().start({ repo: "byro-repo", number: 7 });

    expect(started.path).toBe(created.path);
    expect(git(join(created.path, "packages/utils"), "rev-parse", "HEAD")).toBe(
      newerUtils,
    );
  });

  it("resumes an existing session workspace, keeping its work", async () => {
    const created = await workspaces().create({ session: "glossary-fix" });
    writeFileSync(join(created.path, "work.txt"), "in progress");

    const started = await workspaces().start({ session: "glossary-fix" });

    expect(started.path).toBe(created.path);
    expect(readFileSync(join(created.path, "work.txt"), "utf8")).toBe(
      "in progress",
    );
  });
});

describe("the branch name", () => {
  it("reuses an existing issue branch in any repo, without asking for the title", async () => {
    git(
      join(primaryRoot, "packages/utils"),
      "branch",
      "issue-48-earlier-start",
    );
    const workspace = await workspaces().create(
      { repo: "sheets-framework", number: 48 },
      { slug: "ignored" },
    );

    expect(workspace.branch).toBe("issue-48-earlier-start");
    expect(branchOf(join(workspace.path, "packages/framework"))).toBe(
      "issue-48-earlier-start",
    );
    expect(titleLookups).toBe(0);
  });

  it("reuses an issue branch that only exists on the remote", async () => {
    const utils = join(primaryRoot, "packages/utils");
    git(utils, "branch", "issue-48-pushed");
    git(utils, "push", "origin", "issue-48-pushed");
    git(utils, "branch", "-D", "issue-48-pushed");
    const workspace = await workspaces().create({ repo: "utils", number: 48 });

    expect(branchOf(join(workspace.path, "packages/utils"))).toBe(
      "issue-48-pushed",
    );
  });

  it("takes an explicit slug over the issue title", async () => {
    const workspace = await workspaces().create(
      { repo: "byro-repo", number: 7 },
      { slug: "Short Name" },
    );

    expect(workspace.path).toBe(
      join(temp, "workspaces/byro-repo-issue-7-short-name"),
    );
    expect(branchOf(workspace.path)).toBe("issue-7-short-name");
    expect(titleLookups).toBe(0);
  });

  it("puts named extra repos on the branch too", async () => {
    const workspace = await workspaces().create(
      { repo: "byro-repo", number: 7 },
      { slug: "spans", extraRepos: ["utils"] },
    );

    expect(branchOf(workspace.path)).toBe("issue-7-spans");
    expect(branchOf(join(workspace.path, "packages/utils"))).toBe(
      "issue-7-spans",
    );
    expect(
      branchOf(join(workspace.path, "packages/framework")),
    ).toBeUndefined();
    expect(workspace.branchedRepos).toEqual(["byro-repo", "utils"]);
  });
});

describe("create, a second time", () => {
  it("returns the existing workspace unchanged", async () => {
    const first = await workspaces().create(
      { repo: "byro-repo", number: 7 },
      { slug: "first" },
    );
    writeFileSync(join(first.path, "work.txt"), "in progress");
    const second = await workspaces().create(
      { repo: "byro-repo", number: 7 },
      { slug: "second", extraRepos: ["utils"] },
    );

    expect(second).toEqual(first);
    expect(readFileSync(join(first.path, "work.txt"), "utf8")).toBe(
      "in progress",
    );
    expect(branchOf(join(first.path, "packages/utils"))).toBeUndefined();
    expect(installs).toHaveLength(1);
  });
});

describe("create, when a step fails", () => {
  it("rolls back, leaving no folder or registered worktree, so the next create starts afresh", async () => {
    const failing = workspaces({
      async installDependencies() {
        throw new Error("npm install failed");
      },
    });

    await expect(
      failing.create({ repo: "byro-repo", number: 7 }, { slug: "fails" }),
    ).rejects.toThrow("npm install failed");
    expect(await workspaces().list()).toEqual([]);
    expect(registeredWorktrees()).toEqual([]);

    const retried = await workspaces().create(
      { repo: "byro-repo", number: 7 },
      { slug: "fails" },
    );
    expect(installs).toEqual([retried.path]);
  });
});

describe("list", () => {
  it("reports each workspace's issue, branched repos, dirty repos and creation time", async () => {
    const started = Date.now();
    await workspaces().create(
      { repo: "byro-repo", number: 7 },
      { slug: "clean", extraRepos: ["utils"] },
    );
    const dirty = await workspaces().create(
      { repo: "sheets-framework", number: 48 },
      { slug: "dirty" },
    );
    writeFileSync(join(dirty.path, "packages/framework/README.md"), "edited");

    const listed = await workspaces().list();

    expect(
      listed.map(({ key, branch, branchedRepos, dirtyRepos }) => ({
        key,
        branch,
        branchedRepos,
        dirtyRepos,
      })),
    ).toEqual([
      {
        key: { repo: "byro-repo", number: 7 },
        branch: "issue-7-clean",
        branchedRepos: ["byro-repo", "utils"],
        dirtyRepos: [],
      },
      {
        key: { repo: "sheets-framework", number: 48 },
        branch: "issue-48-dirty",
        branchedRepos: ["sheets-framework"],
        dirtyRepos: ["sheets-framework"],
      },
    ]);
    listed.forEach((workspace) => {
      expect(workspace.createdAt.getTime()).toBeGreaterThanOrEqual(
        started - 1000,
      );
    });
  });

  it("is empty before any workspace exists", async () => {
    expect(await workspaces().list()).toEqual([]);
  });
});
