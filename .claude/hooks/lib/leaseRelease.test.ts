import type { WorkspaceStatus } from "@byronbroughten/spec-runner/IssueWorkspaces";
import { describe, expect, it } from "vitest";

import { endsProcess, leasedWorkspacesOf } from "./leaseRelease.ts";

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

  it("leaves an abandoned lease whose pid this session now has", () => {
    const workspaces = [workspaceOf("a", { ...session, isLive: false })];
    expect(leasedWorkspacesOf(workspaces, session)).toEqual([]);
  });
});

describe("endsProcess", () => {
  it("is true when the session ends with its claude process", () => {
    expect(endsProcess("prompt_input_exit")).toBe(true);
    expect(endsProcess("logout")).toBe(true);
    expect(endsProcess(undefined)).toBe(true);
  });

  it("is false for /clear and /resume, which keep the same process working", () => {
    expect(endsProcess("clear")).toBe(false);
    expect(endsProcess("resume")).toBe(false);
  });
});
