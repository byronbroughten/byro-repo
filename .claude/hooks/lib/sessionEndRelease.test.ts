import type {
  Lease,
  LeasedWorkspace,
} from "@byronbroughten/spec-runner/IssueWorkspaces";
import { describe, expect, it } from "vitest";

import {
  leasedWorkspacesOf,
  sessionEndReleaseOf,
} from "./sessionEndRelease.ts";

const session = { kind: "session", pid: 100 } as const;

function workspaceOf(path: string, lease: Lease): LeasedWorkspace {
  return { path, key: { session: path }, lease };
}

function pathsOf(workspaces: LeasedWorkspace[]): string[] {
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

describe("sessionEndReleaseOf", () => {
  it("ends the supervision on /clear and /resume, naming the end, and keeps the leases", () => {
    expect(sessionEndReleaseOf("clear")).toEqual({
      endedBy: "clear",
      isLeaseReleased: false,
    });
    expect(sessionEndReleaseOf("resume")).toEqual({
      endedBy: "resume",
      isLeaseReleased: false,
    });
  });

  it("ends the supervision and releases the leases on a process end", () => {
    const processEnd = { endedBy: "processEnd", isLeaseReleased: true };
    expect(sessionEndReleaseOf("prompt_input_exit")).toEqual(processEnd);
    expect(sessionEndReleaseOf("logout")).toEqual(processEnd);
    expect(sessionEndReleaseOf(undefined)).toEqual(processEnd);
  });
});
