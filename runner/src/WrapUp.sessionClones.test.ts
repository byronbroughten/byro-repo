import { renameSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { git } from "./GitFixture.ts";
import { IssueWorkspaces } from "./IssueWorkspaces.ts";
import type { WrapUpFailure } from "./WrapUpFailure.ts";
import {
  clonePaths,
  commitIn,
  failureOf,
  primaryOf,
  primaryRoot,
  remoteOf,
  session,
  sessionWorkspace,
  sessionWrapUp,
  subjectsOf,
  useWrapUpHarness,
  workspacesConfig,
} from "./wrapUpHarness.ts";

useWrapUpHarness();

describe("runSession", () => {
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

  it("refuses to push a token-shaped line, keeping the landing, and pushes once a rerun rescans history without it", async () => {
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
    git(framework, "reset", "-q", "--hard", "origin/master");
    writeFileSync(join(framework, "notes.md"), "Notes\n");
    git(framework, "add", "notes.md");
    git(framework, "commit", "-m", "Add notes");
    await sessionWrapUp().runSession(session);

    expect(git(remoteOf("sheets-framework"), "rev-parse", "master")).toBe(
      git(framework, "rev-parse", "master"),
    );
  });
});
