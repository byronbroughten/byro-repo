import { existsSync, renameSync } from "node:fs";

import { describe, expect, it } from "vitest";

import { git } from "./GitFixture.ts";
import { IssueWorkspaces } from "./IssueWorkspaces.ts";
import { LeaseHeld } from "./LeaseHeld.ts";
import type { WrapUpFailure } from "./WrapUpFailure.ts";
import {
  commitIn,
  failureOf,
  noGitHub,
  primaryRoot,
  remoteOf,
  rootCloneOnly,
  session,
  sessionWorkspace,
  sessionWrapUp,
  subjectsOf,
  useWrapUpHarness,
  workspacesConfig,
  wrapUp,
} from "./wrapUpHarness.ts";

useWrapUpHarness(rootCloneOnly);

describe("runSession", () => {
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
