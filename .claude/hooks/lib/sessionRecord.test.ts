import type {
  LeasedWorkspace,
  WorkspaceKey,
} from "@byronbroughten/spec-runner/IssueWorkspaces";
import { describe, expect, it } from "vitest";

import {
  activeAccountOf,
  configFolderOf,
  recordedSessionOf,
  whereYouAreLineOf,
} from "./sessionRecord.ts";

const holder = { kind: "session", pid: 100 } as const;
const issue = { repo: "byro-repo", number: 335 };
const issuePath = "/workspaces/byro-repo-issue-335-session-start";

function leasedBy(
  key: WorkspaceKey,
  path = issuePath,
  pid: number = holder.pid,
): LeasedWorkspace {
  return { path, key, lease: { kind: "session", pid, isLive: true } };
}

describe("recordedSessionOf", () => {
  const session = {
    mode: "interactive",
    sessionId: "session-1",
    holder,
  } as const;

  it("records an implement session under the issue whose workspace this claude leases", () => {
    expect(
      recordedSessionOf({ ...session, leased: [leasedBy(issue)] }),
    ).toEqual({ issue, step: { agent: "implement", sessionId: "session-1" } });
  });

  it("records nothing for a session holding no lease, or another claude's", () => {
    expect(recordedSessionOf({ ...session, leased: [] })).toBeUndefined();
    expect(
      recordedSessionOf({
        ...session,
        leased: [leasedBy(issue, issuePath, 200)],
      }),
    ).toBeUndefined();
  });

  it("records nothing for a session workspace's lease", () => {
    expect(
      recordedSessionOf({
        ...session,
        leased: [leasedBy({ session: "glossary-term" })],
      }),
    ).toBeUndefined();
  });

  it("records nothing for a runner step", () => {
    expect(
      recordedSessionOf({
        ...session,
        mode: "runnerStep",
        leased: [leasedBy(issue)],
      }),
    ).toBeUndefined();
  });
});

describe("whereYouAreLineOf", () => {
  const cleared = {
    source: "clear",
    cwd: issuePath,
    holder,
    leased: [leasedBy(issue)],
  };

  it("names the issue, how to continue it and how to leave it after /clear in its leased workspace", () => {
    expect(whereYouAreLineOf(cleared)).toBe(
      "You are in byro-repo #335's workspace, leased to this session: `/start-issue byro-repo 335` continues it from its handoff, and work outside it needs `ExitWorktree` with `keep` first.",
    );
  });

  it("says where a session cleared in a folder inside that workspace is", () => {
    expect(
      whereYouAreLineOf({ ...cleared, cwd: `${issuePath}/packages/framework` }),
    ).toContain("byro-repo #335's workspace");
  });

  it("says nothing on a startup start", () => {
    expect(
      whereYouAreLineOf({ ...cleared, source: "startup" }),
    ).toBeUndefined();
  });

  it("says nothing for a cwd outside every workspace this claude leases", () => {
    expect(
      whereYouAreLineOf({ ...cleared, cwd: `${issuePath}-other` }),
    ).toBeUndefined();
    expect(
      whereYouAreLineOf({
        ...cleared,
        leased: [leasedBy(issue, issuePath, 200)],
      }),
    ).toBeUndefined();
  });
});

describe("activeAccountOf", () => {
  it("reads the active account's number from `cswap status --json`", () => {
    expect(
      activeAccountOf('{"schemaVersion": 1, "active": {"number": 2}}'),
    ).toBe(2);
  });

  it("is undefined when cswap gives no active account, or no JSON", () => {
    expect(activeAccountOf('{"schemaVersion": 1}')).toBeUndefined();
    expect(activeAccountOf("cswap: command not found")).toBeUndefined();
  });
});

describe("configFolderOf", () => {
  it("is the folder holding the transcript's projects folder", () => {
    expect(
      configFolderOf(
        "/Users/dev/.claude/projects/-workspace-byro-repo/s1.jsonl",
      ),
    ).toBe("/Users/dev/.claude");
  });

  it("is undefined for a transcript outside a projects folder", () => {
    expect(configFolderOf("/tmp/s1.jsonl")).toBeUndefined();
    expect(configFolderOf(undefined)).toBeUndefined();
  });
});
