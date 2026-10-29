import { existsSync, renameSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { git } from "./GitFixture.ts";
import { IssueWorkspaces, type Workspace } from "./IssueWorkspaces.ts";
import { LeaseHeld } from "./LeaseHeld.ts";
import type { WrapUp, WrapUpConfig } from "./WrapUp.ts";
import type { WrapUpFailure } from "./WrapUpFailure.ts";
import {
  clonePaths,
  commitIn,
  failureOf,
  primaryOf,
  primaryRoot,
  remoteOf,
  subjectsOf,
  useWrapUpHarness,
  workspacesConfig,
  wrapUp,
} from "./wrapUpHarness.ts";

useWrapUpHarness();

describe("runSession", () => {
  const session = "glossary-term";
  const noGitHub: WrapUpConfig["github"] = {
    async closeIssue() {
      throw new Error("A session landing closed an issue");
    },
    async parentOf() {
      throw new Error("A session landing read a parent");
    },
    async commentsOf() {
      throw new Error("A session landing read comments");
    },
  };

  function sessionWrapUp(): WrapUp {
    return wrapUp({ github: noGitHub });
  }

  async function sessionWorkspace(): Promise<Workspace> {
    return IssueWorkspaces.init(workspacesConfig()).create({ session });
  }

  it("lands each repo whose session branch is ahead, the clone before the root, with no GitHub calls", async () => {
    const workspace = await sessionWorkspace();
    commitIn(workspace, "byro-repo", "terms.md", "# Terms\n");
    commitIn(workspace, "sheets-framework", "hook.ts", "export {};\n");

    const result = await sessionWrapUp().runSession(session);

    expect(subjectsOf("byro-repo")[0]).toBe("Add terms.md");
    expect(subjectsOf("sheets-framework")[0]).toBe("Add hook.ts");
    Object.keys(clonePaths).forEach((repo) => {
      const name = repo as keyof typeof clonePaths;
      expect(git(remoteOf(name), "rev-parse", "master")).toBe(
        git(primaryOf(name), "rev-parse", "master"),
      );
      expect(git(primaryOf(name), "branch", "--list", "session-*")).toBe("");
    });
    expect(result.filesChanged).toBe(2);
    expect(await IssueWorkspaces.init(workspacesConfig()).list()).toEqual([]);
  });

  it("keeps the workspace leased, with every repo's session branch level with the pushed master", async () => {
    const workspaces = IssueWorkspaces.init(workspacesConfig());
    const workspace = await sessionWorkspace();
    const holder = { kind: "session" as const, pid: process.pid };
    await workspaces.takeLease(workspace, holder);
    commitIn(workspace, "byro-repo", "terms.md", "# Terms\n");
    const framework = primaryOf("sheets-framework");
    writeFileSync(join(framework, "landed.ts"), "export {};\n");
    git(framework, "add", "landed.ts");
    git(framework, "commit", "-m", "Land elsewhere");

    await sessionWrapUp().keepSession(session, { holder });

    Object.entries(clonePaths).forEach(([repo, clonePath]) => {
      const worktree = join(workspace.path, clonePath);
      const master = git(
        primaryOf(repo as keyof typeof clonePaths),
        "rev-parse",
        "master",
      );
      expect(git(worktree, "branch", "--show-current")).toBe(
        `session-${session}`,
      );
      expect(git(worktree, "rev-parse", "HEAD")).toBe(master);
    });
    expect(subjectsOf("byro-repo")[0]).toBe("Add terms.md");
    expect(git(remoteOf("byro-repo"), "rev-parse", "master")).toBe(
      git(primaryRoot, "rev-parse", "master"),
    );
    expect(await workspaces.leaseOf(workspace)).toMatchObject(holder);
  });

  it("refuses a workspace another live session leases, landing nothing", async () => {
    const workspace = await sessionWorkspace();
    await IssueWorkspaces.init(workspacesConfig()).takeLease(workspace, {
      kind: "session",
      pid: process.ppid,
    });
    commitIn(workspace, "byro-repo", "terms.md", "# Terms\n");
    const masterBefore = git(primaryRoot, "rev-parse", "master");

    const failure = await sessionWrapUp()
      .runSession(session, { holder: { kind: "session", pid: process.pid } })
      .catch((error: unknown) => error);

    expect(failure).toBeInstanceOf(LeaseHeld);
    expect(git(primaryRoot, "rev-parse", "master")).toBe(masterBefore);
  });

  it("keeps a commit made on the landed build when a kept rerun levels the workspace", async () => {
    const workspace = await sessionWorkspace();
    commitIn(workspace, "byro-repo", "terms.md", "# Terms\n");
    const remote = remoteOf("byro-repo");
    renameSync(remote, `${remote}.gone`);
    expect(await failureOf(sessionWrapUp().keepSession(session))).toBe(
      "network",
    );
    renameSync(`${remote}.gone`, remote);
    commitIn(workspace, "byro-repo", "more.md", "# More\n");

    await sessionWrapUp().keepSession(session);
    await sessionWrapUp().runSession(session);

    expect(subjectsOf("byro-repo").slice(0, 2)).toEqual([
      "Add more.md",
      "Add terms.md",
    ]);
  });

  it("names the failure when edits made since the landing block leveling", async () => {
    const workspace = await sessionWorkspace();
    commitIn(workspace, "byro-repo", "terms.md", "# Terms\n");
    const framework = primaryOf("sheets-framework");
    writeFileSync(join(framework, "landed.ts"), "export {};\n");
    git(framework, "add", "landed.ts");
    git(framework, "commit", "-m", "Land elsewhere");
    const remote = remoteOf("byro-repo");
    renameSync(remote, `${remote}.gone`);
    expect(await failureOf(sessionWrapUp().keepSession(session))).toBe(
      "network",
    );
    renameSync(`${remote}.gone`, remote);
    writeFileSync(
      join(workspace.path, clonePaths["sheets-framework"], "landed.ts"),
      "",
    );

    expect(await failureOf(sessionWrapUp().keepSession(session))).toBe(
      "dirty-tree",
    );
  });

  it("stops on a red check before any fast-forward, naming it, and lands on a rerun after the fix", async () => {
    const workspace = await sessionWorkspace();
    commitIn(workspace, "byro-repo", "RED", "");
    const masterBefore = git(primaryRoot, "rev-parse", "master");

    const failure = await sessionWrapUp()
      .runSession(session)
      .catch((error: unknown) => error);

    expect((failure as WrapUpFailure).kind).toBe("red-checks");
    expect((failure as WrapUpFailure).message).toContain(
      "sh -c test ! -f RED failed after the merges",
    );
    expect(git(primaryRoot, "rev-parse", "master")).toBe(masterBefore);
    expect(git(remoteOf("byro-repo"), "rev-parse", "master")).toBe(
      masterBefore,
    );

    git(workspace.path, "rm", "-q", "RED");
    git(workspace.path, "commit", "-m", "Drop RED");
    await sessionWrapUp().runSession(session);

    expect(subjectsOf("byro-repo")[0]).toBe("Drop RED");
  });

  it("runs the checks on a kept landing too", async () => {
    const workspace = await sessionWorkspace();
    commitIn(workspace, "byro-repo", "RED", "");

    expect(await failureOf(sessionWrapUp().keepSession(session))).toBe(
      "red-checks",
    );
  });

  it("refuses uncommitted work in any repo of the workspace", async () => {
    const workspace = await sessionWorkspace();
    commitIn(workspace, "byro-repo", "terms.md", "# Terms\n");
    writeFileSync(
      join(workspace.path, clonePaths["sheets-framework"], "loose.ts"),
      "",
    );
    const masterBefore = git(primaryRoot, "rev-parse", "master");

    expect(await failureOf(sessionWrapUp().runSession(session))).toBe(
      "dirty-tree",
    );
    expect(git(primaryRoot, "rev-parse", "master")).toBe(masterBefore);
  });

  it("refuses to push a token-shaped line, keeping the landing, and pushes once a rerun rescans it clean", async () => {
    const workspace = await sessionWorkspace();
    const key = `AIza${"x7".repeat(18).slice(0, 35)}`;
    commitIn(
      workspace,
      "sheets-framework",
      "keys.ts",
      `export const a = 1;\nexport const key = "${key}";\n`,
    );
    const remoteBefore = git(
      remoteOf("sheets-framework"),
      "rev-parse",
      "master",
    );

    const failure = await sessionWrapUp()
      .runSession(session)
      .catch((error: unknown) => error);

    expect((failure as WrapUpFailure).kind).toBe("secret-scan");
    expect((failure as WrapUpFailure).message).toContain(
      "sheets-framework keys.ts:2",
    );
    expect(git(remoteOf("sheets-framework"), "rev-parse", "master")).toBe(
      remoteBefore,
    );
    expect(subjectsOf("sheets-framework")[0]).toBe("Add keys.ts");

    const framework = primaryOf("sheets-framework");
    git(framework, "rm", "-q", "keys.ts");
    git(framework, "commit", "-m", "Drop the key");
    await sessionWrapUp().runSession(session);

    expect(git(remoteOf("sheets-framework"), "rev-parse", "master")).toBe(
      git(framework, "rev-parse", "master"),
    );
  });

  it("resumes after a failed push, skipping the steps already done", async () => {
    const workspace = await sessionWorkspace();
    commitIn(workspace, "byro-repo", "terms.md", "# Terms\n");
    const remote = remoteOf("byro-repo");
    renameSync(remote, `${remote}.gone`);

    expect(await failureOf(sessionWrapUp().runSession(session))).toBe(
      "network",
    );
    const landed = git(primaryRoot, "rev-parse", "master");

    renameSync(`${remote}.gone`, remote);
    const result = await sessionWrapUp().runSession(session);

    expect(git(remote, "rev-parse", "master")).toBe(landed);
    expect(result.completed).toEqual([
      "clean-check",
      "files-changed",
      "merges",
      "checks",
      "fast-forward",
      "secret-scan",
      "push",
      "delete-branches",
      "remove-workspace",
    ]);
  });

  it("retries a failed branch delete on a rerun, then removes the workspace", async () => {
    const workspace = await sessionWorkspace();
    commitIn(workspace, "byro-repo", "terms.md", "# Terms\n");
    git(workspace.path, "push", "origin", `session-${session}`);
    const remote = remoteOf("byro-repo");
    const first = await wrapUp({
      github: noGitHub,
      log(line) {
        if (line === "Done: push.") renameSync(remote, `${remote}.gone`);
      },
    }).runSession(session);
    expect(first.branchDeleteFailures).toHaveLength(1);
    expect(existsSync(workspace.path)).toBe(true);

    renameSync(`${remote}.gone`, remote);
    const result = await sessionWrapUp().runSession(session);

    expect(result.branchDeleteFailures).toEqual([]);
    expect(git(remote, "branch", "--list", "session-*")).toBe("");
    expect(existsSync(workspace.path)).toBe(false);
  });

  it("lands again from the kept workspace", async () => {
    const workspace = await sessionWorkspace();
    commitIn(workspace, "byro-repo", "terms.md", "# Terms\n");
    await sessionWrapUp().keepSession(session);
    commitIn(workspace, "byro-repo", "more.md", "# More\n");

    await sessionWrapUp().runSession(session);

    expect(subjectsOf("byro-repo").slice(0, 2)).toEqual([
      "Add more.md",
      "Add terms.md",
    ]);
    expect(await IssueWorkspaces.init(workspacesConfig()).list()).toEqual([]);
  });
});
