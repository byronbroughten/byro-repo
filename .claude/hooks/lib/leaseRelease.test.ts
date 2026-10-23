import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type {
  Lease,
  LeasedWorkspace,
} from "@byronbroughten/spec-runner/IssueWorkspaces";
import { SupervisionRecords } from "@byronbroughten/spec-runner/SupervisionRecords";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  endsProcess,
  leasedWorkspacesOf,
  releaseSupervisionAtEnd,
} from "./leaseRelease.ts";

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

describe("releaseSupervisionAtEnd", () => {
  const supervisor = { kind: "session", pid: process.pid } as const;
  const spec = { repo: "byro-repo", number: 331 };
  let stateFolder = "";

  beforeEach(() => {
    stateFolder = mkdtempSync(join(tmpdir(), "supervision-"));
  });

  afterEach(() => {
    rmSync(stateFolder, { recursive: true, force: true });
  });

  it("deletes the session's supervision record when the session ends", async () => {
    const records = SupervisionRecords.init(stateFolder);
    await records.supervise(supervisor, "byronbroughten", spec);

    await releaseSupervisionAtEnd(records, supervisor, "prompt_input_exit");

    expect(await records.recordOf(supervisor)).toBeUndefined();
  });

  it("keeps it on a /clear end, which keeps the same process supervising", async () => {
    const records = SupervisionRecords.init(stateFolder);
    await records.supervise(supervisor, "byronbroughten", spec);

    await releaseSupervisionAtEnd(records, supervisor, "clear");

    expect((await records.recordOf(supervisor))?.spec).toEqual(spec);
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
