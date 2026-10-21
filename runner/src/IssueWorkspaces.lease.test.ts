import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { git } from "./GitFixture.ts";
import type { LeaseHolder } from "./IssueWorkspaces.ts";
import {
  branchOf,
  primaryRoot,
  primaryStates,
  registeredWorktrees,
  useIssueWorkspacesHarness,
  workspaces,
} from "./issueWorkspacesHarness.ts";

useIssueWorkspacesHarness();

// The test runner's parent outlives every test, so it stands in for another live holder.
const liveSession: LeaseHolder = { kind: "session", pid: process.ppid };

function deadPid(): number {
  const { pid } = spawnSync("node", ["-e", ""]);
  if (pid === undefined) throw new Error("The throwaway process didn't start");
  return pid;
}

describe("a lease", () => {
  it("is taken, read back with its holder live, and leaves the workspace clean", async () => {
    const workspace = await workspaces().create({ session: "glossary-fix" });

    await workspaces().takeLease(workspace, liveSession);

    expect(await workspaces().leaseOf(workspace)).toEqual({
      ...liveSession,
      isLive: true,
    });
    const found = await workspaces().find({ session: "glossary-fix" });
    expect(found?.lease).toEqual({ ...liveSession, isLive: true });
    expect(found?.dirtyRepos).toEqual([]);
  });

  it("is refused to another holder while its holder lives, naming the holder, and re-taken by its own", async () => {
    const workspace = await workspaces().create({ session: "glossary-fix" });
    await workspaces().takeLease(workspace, liveSession);

    await expect(
      workspaces().takeLease(workspace, { kind: "run", pid: process.pid }),
    ).rejects.toThrow(`a session (pid ${process.ppid})`);
    await workspaces().takeLease(workspace, liveSession);
    expect(await workspaces().leaseOf(workspace)).toMatchObject(liveSession);
  });

  it("is read as abandoned once its holder dies, and taken over", async () => {
    const workspace = await workspaces().create({ session: "glossary-fix" });
    const dead: LeaseHolder = { kind: "session", pid: deadPid() };
    await workspaces().takeLease(workspace, dead);

    expect(await workspaces().leaseOf(workspace)).toEqual({
      ...dead,
      isLive: false,
    });
    await workspaces().takeLease(workspace, { kind: "run", pid: process.pid });
    expect(await workspaces().leaseOf(workspace)).toEqual({
      kind: "run",
      pid: process.pid,
      isLive: true,
    });
  });

  it("is read as abandoned when its process ID now belongs to a process started since", async () => {
    const workspace = await workspaces().create({ session: "glossary-fix" });
    await workspaces().takeLease(workspace, liveSession);
    const gitDir = execFileSync("git", ["rev-parse", "--absolute-git-dir"], {
      cwd: workspace.path,
      encoding: "utf8",
    }).trim();
    const leasePath = join(gitDir, "workspace.lease");
    const lease = JSON.parse(readFileSync(leasePath, "utf8")) as object;
    writeFileSync(
      leasePath,
      JSON.stringify({ ...lease, startedAt: "Thu Jan  1 00:00:00 1970" }),
    );

    expect(await workspaces().leaseOf(workspace)).toEqual({
      ...liveSession,
      isLive: false,
    });
  });

  it("is released", async () => {
    const workspace = await workspaces().create({ session: "glossary-fix" });
    await workspaces().takeLease(workspace, liveSession);

    await workspaces().releaseLease(workspace);

    expect(await workspaces().leaseOf(workspace)).toBeUndefined();
    await workspaces().takeLease(workspace, { kind: "run", pid: process.pid });
  });

  it("releases its holder's other lease when taken, leaving that workspace's branch and files in place", async () => {
    const first = await workspaces().create(
      { repo: "byro-repo", number: 7 },
      { slug: "first" },
    );
    writeFileSync(join(first.path, "work.txt"), "in progress");
    await workspaces().takeLease(first, liveSession);
    const second = await workspaces().create({ session: "glossary-fix" });

    await workspaces().takeLease(second, liveSession);

    expect(await workspaces().leaseOf(first)).toBeUndefined();
    expect(await workspaces().leaseOf(second)).toMatchObject(liveSession);
    expect(branchOf(first.path)).toBe("issue-7-first");
    expect(readFileSync(join(first.path, "work.txt"), "utf8")).toBe(
      "in progress",
    );
  });

  it("leaves another holder's lease alone when taken", async () => {
    const theirs = await workspaces().create({ session: "theirs" });
    await workspaces().takeLease(theirs, liveSession);
    const mine = await workspaces().create({ session: "mine" });

    await workspaces().takeLease(mine, { kind: "run", pid: process.pid });

    expect(await workspaces().leaseOf(theirs)).toMatchObject(liveSession);
  });

  it("is listed with its workspace by leases(), which skips a workspace with none", async () => {
    const key = { session: "glossary-fix" };
    const leased = await workspaces().create(key);
    await workspaces().create({ session: "unleased" });
    await workspaces().takeLease(leased, liveSession);

    expect(await workspaces().leases()).toEqual([
      { path: leased.path, key, lease: { ...liveSession, isLive: true } },
    ]);
  });

  it("keeps start from resuming the workspace for anyone but its holder", async () => {
    const key = { repo: "byro-repo", number: 7 };
    const workspace = await workspaces().create(key, { slug: "leased" });
    await workspaces().takeLease(workspace, liveSession);

    await expect(workspaces().start(key)).rejects.toThrow(
      `a session (pid ${process.ppid})`,
    );
    expect((await workspaces().start(key, liveSession)).path).toBe(
      workspace.path,
    );
  });

  it("is taken by start for the holder it names", async () => {
    const workspace = await workspaces().start(
      { session: "glossary-fix" },
      liveSession,
    );

    expect(await workspaces().leaseOf(workspace)).toMatchObject(liveSession);
  });

  it("keeps remove from removing the workspace, even with force, until it is released or its holder dies", async () => {
    const workspace = await workspaces().create({ session: "glossary-fix" });
    await workspaces().takeLease(workspace, liveSession);

    await expect(
      workspaces().remove(workspace, { force: true }),
    ).rejects.toThrow(`a session (pid ${process.ppid})`);
    expect(existsSync(workspace.path)).toBe(true);

    await workspaces().releaseLease(workspace);
    await workspaces().remove(workspace);
    expect(existsSync(workspace.path)).toBe(false);
  });

  it("lets its holder remove a clean workspace it holds", async () => {
    const workspace = await workspaces().create({ session: "glossary-fix" });
    await workspaces().takeLease(workspace, liveSession);

    await workspaces().remove(workspace, { holder: liveSession });

    expect(existsSync(workspace.path)).toBe(false);
  });

  it("still refuses its holder a dirty workspace without force", async () => {
    const workspace = await workspaces().create({ session: "glossary-fix" });
    await workspaces().takeLease(workspace, liveSession);
    writeFileSync(join(workspace.path, "work.txt"), "in progress");

    await expect(
      workspaces().remove(workspace, { holder: liveSession }),
    ).rejects.toThrow(/uncommitted changes/);
    expect(existsSync(workspace.path)).toBe(true);

    await workspaces().remove(workspace, { holder: liveSession, force: true });
    expect(existsSync(workspace.path)).toBe(false);
  });

  it("keeps a caller other than its holder from removing the workspace, even with force", async () => {
    const workspace = await workspaces().create({ session: "glossary-fix" });
    await workspaces().takeLease(workspace, liveSession);

    await expect(
      workspaces().remove(workspace, {
        holder: { kind: "session", pid: process.pid },
        force: true,
      }),
    ).rejects.toThrow(`a session (pid ${process.ppid})`);
    expect(existsSync(workspace.path)).toBe(true);
  });

  it("leaves remove free once its holder dies", async () => {
    const workspace = await workspaces().create({ session: "glossary-fix" });
    await workspaces().takeLease(workspace, {
      kind: "session",
      pid: deadPid(),
    });

    await workspaces().remove(workspace);

    expect(existsSync(workspace.path)).toBe(false);
  });

  it("is gone from a workspace removed and created again", async () => {
    const key = { session: "glossary-fix" };
    const workspace = await workspaces().create(key);
    await workspaces().takeLease(workspace, {
      kind: "session",
      pid: deadPid(),
    });
    await workspaces().remove(workspace);

    const recreated = await workspaces().create(key);

    expect(recreated.path).toBe(workspace.path);
    expect(await workspaces().leaseOf(recreated)).toBeUndefined();
  });
});

describe("remove", () => {
  it("refuses a dirty workspace without force and leaves it in place", async () => {
    const workspace = await workspaces().create(
      { repo: "byro-repo", number: 7 },
      { slug: "dirty" },
    );
    writeFileSync(join(workspace.path, "packages/utils/new.txt"), "untracked");

    await expect(workspaces().remove(workspace)).rejects.toThrow(/utils/);
    expect(existsSync(join(workspace.path, "packages/utils/new.txt"))).toBe(
      true,
    );
    expect(registeredWorktrees()).toHaveLength(3);
  });

  it("refuses a workspace holding commits on no branch without force, and removes it with force", async () => {
    const workspace = await workspaces().create(
      { repo: "byro-repo", number: 7 },
      { slug: "orphaned" },
    );
    const utils = join(workspace.path, "packages/utils");
    writeFileSync(join(utils, "kept.txt"), "committed");
    git(utils, "add", "kept.txt");
    git(utils, "commit", "-m", "Detached work");

    await expect(workspaces().remove(workspace)).rejects.toThrow(
      /commits on no branch in utils/,
    );
    expect(existsSync(utils)).toBe(true);

    await workspaces().remove(workspace, { force: true });
    expect(existsSync(workspace.path)).toBe(false);
  });

  it("removes a clean workspace, leaving no worktree registered and the primaries untouched", async () => {
    const before = primaryStates();
    const workspace = await workspaces().create(
      { repo: "sheets-framework", number: 48 },
      { slug: "clean" },
    );

    await workspaces().remove(workspace);

    expect(existsSync(workspace.path)).toBe(false);
    expect(registeredWorktrees()).toEqual([]);
    expect(await workspaces().list()).toEqual([]);
    expect(primaryStates()).toEqual(before);
    expect(
      readFileSync(
        join(primaryRoot, "packages/framework/sheets.config.json"),
        "utf8",
      ),
    ).toBe("{}");
  });

  it("removes a dirty workspace with force", async () => {
    const workspace = await workspaces().create(
      { repo: "byro-repo", number: 7 },
      { slug: "forced" },
    );
    writeFileSync(join(workspace.path, "README.md"), "edited");
    writeFileSync(join(workspace.path, "packages/utils/new.txt"), "untracked");

    await workspaces().remove(workspace, { force: true });

    expect(existsSync(workspace.path)).toBe(false);
    expect(registeredWorktrees()).toEqual([]);
  });
});
