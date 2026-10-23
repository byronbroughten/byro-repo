import { describe, expect, it } from "vitest";

import {
  branchDecision,
  type BranchGuardInput,
  endedRecord,
  headMovingCheckouts,
  isLive,
  refreshedRecord,
  type SessionRecord,
  startedRecord,
} from "./branchGuard.ts";

const root = "/code/byro-repo";
const framework = `${root}/packages/framework`;
const primaryCheckouts = [root, framework];
const workspace = `${root}/.claude/worktrees/byro-repo-issue-1-x`;

const existingPaths = new Set([`${root}/src/a.ts`, `${root}/src`, root]);
const now = 10 * 24 * 60 * 60 * 1000;

function decide(
  props: Partial<BranchGuardInput> & Pick<BranchGuardInput, "command">,
) {
  return branchDecision({
    cwd: root,
    mode: "interim",
    primaryCheckouts,
    ownCheckouts: {},
    currentCheckouts: {},
    isExistingPath: (path) => existingPaths.has(path),
    ...props,
  });
}

describe("branchDecision, strict", () => {
  it.each([
    "git checkout feature",
    "git checkout 3a1c785",
    "git checkout -b issue-1-x",
    "git switch feature",
    "git switch -c issue-1-x",
    "git switch -",
    "git checkout --detach HEAD~1",
  ])("denies the branch move `%s` in a primary checkout", (command) => {
    const decision = decide({ command, mode: "strict" });
    expect(decision.permissionDecision).toBe("deny");
    expect(decision.reason).toMatch(/issue workspace/);
  });

  it.each([
    "git checkout -- src/a.ts",
    "git checkout master -- src/a.ts",
    "git checkout src/a.ts",
    "git checkout .",
    "git checkout HEAD src/a.ts",
    "git checkout -p",
    "git checkout --detach",
    "git switch --help",
    "git status",
    "git log --oneline",
    "npm test",
    "git checkout",
  ])("allows `%s`", (command) => {
    expect(decide({ command, mode: "strict" }).permissionDecision).toBe(
      "allow",
    );
  });

  it.each([
    ["git -C packages/framework switch feature", root],
    [`git -C ${framework} checkout feature`, "/tmp"],
    ["cd packages/framework && git checkout feature", root],
    ["cd .. && git checkout feature", `${framework}/src`],
    ["git -C .. checkout feature", `${framework}/src`],
    ["npm test; git --no-pager -c core.x=y switch feature", root],
  ])("resolves `%s` from %s to a primary checkout", (command, cwd) => {
    expect(decide({ command, cwd, mode: "strict" }).permissionDecision).toBe(
      "deny",
    );
  });

  it.each([
    ["git checkout feature", workspace],
    [`git -C ${workspace}/packages/framework switch feature`, root],
    ["git switch feature", `${workspace}/packages/framework/src`],
    [`cd ${workspace} && git checkout -b y`, root],
    ["git checkout feature", `${root}/.claude/worktrees/agent-1`],
    ["git checkout feature", "/somewhere/else"],
  ])("allows `%s` from %s, outside every primary checkout", (command, cwd) => {
    expect(decide({ command, cwd, mode: "strict" }).permissionDecision).toBe(
      "allow",
    );
  });
});

describe("branchDecision, interim", () => {
  const onMaster = { branch: "master", head: "aaa111" };
  const onIssue = { branch: "issue-1-x", head: "bbb222" };

  it.each([
    "git checkout feature",
    "git checkout 3a1c785",
    "git checkout -b issue-1-x",
    "git switch feature",
    "git switch -c issue-1-x",
  ])("allows `%s`, leaving branch moves to the developer", (command) => {
    expect(
      decide({ command, currentCheckouts: { [root]: onMaster } })
        .permissionDecision,
    ).toBe("allow");
  });

  it.each([
    ["to another commit", onIssue],
    [
      "to another branch at the same commit",
      { ...onIssue, head: onMaster.head },
    ],
  ])(
    "denies a commit after HEAD moved %s since this session recorded it, naming the way through",
    (_case, current) => {
      const decision = decide({
        command: 'git add -A && git commit -m "x"',
        ownCheckouts: { [root]: onMaster },
        currentCheckouts: { [root]: current },
      });
      expect(decision.permissionDecision).toBe("deny");
      expect(decision.reason).toMatch(/moved/);
      expect(decision.reason).toMatch(/issue workspace/);
    },
  );

  it.each([
    ["HEAD has not moved", { [root]: onMaster }, { [root]: onMaster }],
    ["this session has no record of the checkout", {}, { [root]: onIssue }],
  ])("allows a commit when %s", (_case, ownCheckouts, currentCheckouts) => {
    expect(
      decide({ command: "git commit -m x", ownCheckouts, currentCheckouts })
        .permissionDecision,
    ).toBe("allow");
  });

  it("allows a commit after HEAD moved in an issue workspace", () => {
    const decision = decide({
      command: "git commit -m x",
      cwd: workspace,
      ownCheckouts: { [root]: onMaster },
      currentCheckouts: { [root]: onIssue },
    });
    expect(decision.permissionDecision).toBe("allow");
  });

  it("leaves commits alone in strict form", () => {
    const decision = decide({
      command: "git commit -m x",
      mode: "strict",
      ownCheckouts: { [root]: onMaster },
      currentCheckouts: { [root]: onIssue },
    });
    expect(decision.permissionDecision).toBe("allow");
  });
});

describe("isLive", () => {
  const day = 24 * 60 * 60 * 1000;
  const record: SessionRecord = {
    sessionId: "s",
    recordedAt: now - day + 1,
    checkouts: {},
  };

  it("is true for a record with no end, under a day old", () => {
    expect(isLive(record, now)).toBe(true);
  });

  it("is false once the session ended", () => {
    expect(isLive({ ...record, endedAt: now - 1 }, now)).toBe(false);
  });

  it("is false for a record over a day old", () => {
    expect(isLive({ ...record, recordedAt: now - day - 1 }, now)).toBe(false);
  });
});

describe("session records", () => {
  const onMaster = { branch: "master", head: "aaa111" };
  const onIssue = { branch: "issue-1-x", head: "bbb222" };

  it("starts a record of each primary's branch and HEAD", () => {
    expect(startedRecord(undefined, "s", { [root]: onMaster }, 5)).toEqual({
      sessionId: "s",
      recordedAt: 5,
      checkouts: { [root]: onMaster },
    });
  });

  it("keeps a live record when the session starts again, as after a compact", () => {
    const live = startedRecord(undefined, "s", { [root]: onMaster }, 5);
    expect(startedRecord(live, "s", { [root]: onIssue }, 6)).toBe(live);
  });

  it("replaces an ended record, as on resume", () => {
    const ended = endedRecord(
      startedRecord(undefined, "s", { [root]: onMaster }, 5),
      6,
    );
    expect(ended.endedAt).toBe(6);
    expect(startedRecord(ended, "s", { [root]: onIssue }, 7).checkouts).toEqual(
      { [root]: onIssue },
    );
  });

  it("re-records a checkout this session's own command may have moved, and only that one", () => {
    const record: SessionRecord = {
      sessionId: "s",
      recordedAt: 5,
      checkouts: { [root]: onMaster, [framework]: onMaster },
      refreshPending: [root],
    };
    expect(
      refreshedRecord(record, { [root]: onIssue, [framework]: onIssue }, 8),
    ).toEqual({
      sessionId: "s",
      recordedAt: 8,
      checkouts: { [root]: onIssue, [framework]: onMaster },
    });
  });
});

describe("headMovingCheckouts", () => {
  it.each([
    ["git commit -m x", [root]],
    [
      "git -C packages/framework merge main && git checkout feature",
      [framework, root],
    ],
    ["git pull && git rebase master && git reset --hard", [root]],
    ["git status && git log", []],
    ["git checkout -- a.ts", [root]],
    ["git commit -m x", [], workspace],
  ])("finds the checkouts `%s` may move", (command, expected, cwd = root) => {
    expect(headMovingCheckouts({ command, cwd, primaryCheckouts })).toEqual(
      expected,
    );
  });
});
