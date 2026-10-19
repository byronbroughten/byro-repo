import { existsSync, renameSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { git } from "./GitFixture.ts";
import { IssueWorkspaces } from "./IssueWorkspaces.ts";
import {
  commitIn,
  failureOf,
  github,
  primaryOf,
  remoteOf,
  sleeps,
  spec,
  ticket,
  useWrapUpHarness,
  workspacesConfig,
  workspaceWith,
  wrapUp,
  writeFacts,
} from "./wrapUpHarness.ts";

useWrapUpHarness();

describe("run", () => {
  it("deletes the branch locally and on the remote, removes the workspace and closes the issue", async () => {
    const workspace = await workspaceWith();
    commitIn(workspace, "byro-repo", "script.ts", "export {};\n");
    git(join(workspace.path), "push", "origin", "issue-218-wrap-up-script");
    writeFacts({
      boxesUndone: [{ box: "Fake gh tests", reason: "covered by a port" }],
    });

    await wrapUp().run(ticket);

    expect(git(primaryOf("byro-repo"), "branch", "--list", "issue-218-*")).toBe(
      "",
    );
    expect(git(remoteOf("byro-repo"), "branch", "--list", "issue-218-*")).toBe(
      "",
    );
    expect(existsSync(workspace.path)).toBe(false);
    expect(github.closed).toEqual([
      {
        issue: ticket,
        comment:
          "Landed the wrap-up script.\n\nLeft undone:\n- Fake gh tests: covered by a port",
      },
    ]);
  });

  it("releases the lease of the session landing it, removing the workspace", async () => {
    const workspace = await workspaceWith();
    commitIn(workspace, "byro-repo", "script.ts", "export {};\n");
    await IssueWorkspaces.init(workspacesConfig()).takeLease(workspace, {
      kind: "session",
      pid: process.ppid,
    });
    writeFacts();

    await wrapUp().run(ticket);

    expect(existsSync(workspace.path)).toBe(false);
    expect(await IssueWorkspaces.init(workspacesConfig()).list()).toEqual([]);
    expect(github.closed.map(({ issue }) => issue)).toEqual([ticket]);
  });

  it("logs a failed branch delete, keeps the workspace and still closes the issue", async () => {
    const workspace = await workspaceWith();
    commitIn(workspace, "byro-repo", "script.ts", "export {};\n");
    writeFacts();

    const result = await wrapUp({
      log(line) {
        if (line === "Done: push.") {
          renameSync(remoteOf("byro-repo"), `${remoteOf("byro-repo")}.gone`);
        }
      },
    }).run(ticket);

    expect(result.branchDeleteFailures).toHaveLength(1);
    expect(existsSync(workspace.path)).toBe(true);
    expect(github.closed).toHaveLength(1);
  });

  it("names a parent whose sub-issues are all closed as ready to close", async () => {
    github.parents.set(ticket.number, {
      issue: spec,
      labels: [],
      subIssues: { total: 3, completed: 3 },
    });
    const workspace = await workspaceWith();
    commitIn(workspace, "byro-repo", "script.ts", "export {};\n");
    writeFacts();

    const result = await wrapUp().run(ticket);

    expect(result.parent).toEqual({ kind: "ready-to-close", parent: spec });
  });

  it("never offers a wayfinder map for closing", async () => {
    github.parents.set(ticket.number, {
      issue: spec,
      labels: ["wayfinder:map"],
      subIssues: { total: 3, completed: 3 },
    });
    const workspace = await workspaceWith();
    commitIn(workspace, "byro-repo", "script.ts", "export {};\n");
    writeFacts();

    const result = await wrapUp().run(ticket);

    expect(result.parent).toEqual({ kind: "map", parent: spec });
  });

  it("fails the parent check when the parent's sub-issue summary can't be read", async () => {
    github.parents.set(ticket.number, {
      issue: spec,
      labels: [],
      subIssues: undefined,
    });
    const workspace = await workspaceWith();
    commitIn(workspace, "byro-repo", "script.ts", "export {};\n");
    writeFacts();

    expect(await failureOf(wrapUp().run(ticket))).toBe("parent-check");
    expect(github.closed).toHaveLength(1);
  });

  it("retries a failing gh call with exponential backoff", async () => {
    const workspace = await workspaceWith();
    commitIn(workspace, "byro-repo", "script.ts", "export {};\n");
    writeFacts();
    github.failuresLeft = 2;

    await wrapUp().run(ticket);

    expect(sleeps).toEqual([100, 200]);
    expect(github.closed).toHaveLength(1);
  });

  it("gives up as a network failure after three tries", async () => {
    const workspace = await workspaceWith();
    commitIn(workspace, "byro-repo", "script.ts", "export {};\n");
    writeFacts();
    github.failuresLeft = 3;

    expect(await failureOf(wrapUp().run(ticket))).toBe("network");
    expect(sleeps).toEqual([100, 200]);
  });
});
