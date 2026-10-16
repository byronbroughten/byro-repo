import type { WorkspaceStatus } from "@byronbroughten/spec-runner/IssueWorkspaces";
import { describe, expect, it } from "vitest";

import { leasedWorkspacesOf } from "./leaseRelease.ts";

const session = { kind: "session", pid: 100 } as const;

function workspaceOf(
  path: string,
  lease?: WorkspaceStatus["lease"],
): WorkspaceStatus {
  return {
    path,
    key: { session: path },
    branch: `session-${path}`,
    branchedRepos: [],
    dirtyRepos: [],
    createdAt: new Date(0),
    lease,
  };
}

function pathsOf(workspaces: WorkspaceStatus[]): string[] {
  return workspaces.map(({ path }) => path);
}

describe("leasedWorkspacesOf", () => {
  it("returns every workspace this session leases", () => {
    const workspaces = [
      workspaceOf("a", { ...session, isLive: true }),
      workspaceOf("b", { ...session, isLive: true }),
    ];
    expect(pathsOf(leasedWorkspacesOf(workspaces, session))).toEqual([
      "a",
      "b",
    ]);
  });

  it("leaves a workspace with no lease", () => {
    expect(leasedWorkspacesOf([workspaceOf("a")], session)).toEqual([]);
  });

  it("leaves another session's lease and a run's lease on the same pid", () => {
    const workspaces = [
      workspaceOf("a", { kind: "session", pid: 200, isLive: true }),
      workspaceOf("b", { kind: "run", pid: 100, isLive: true }),
    ];
    expect(leasedWorkspacesOf(workspaces, session)).toEqual([]);
  });
});
