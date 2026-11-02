import { describe, expect, it } from "vitest";

import { workspaceLineOf } from "./workspaceLine.ts";

const whole = {
  path: "/w/byro-repo-issue-7-whole",
  key: { repo: "byro-repo", number: 7 },
  branch: "issue-7-whole",
  branchedRepos: ["byro-repo"],
  dirtyRepos: [],
  createdAt: new Date(),
};

describe("workspaceLineOf", () => {
  it("shows a whole workspace's branch, repos, state, lease, age and path", () => {
    expect(workspaceLineOf(whole)).toBe(
      "byro-repo #7  issue-7-whole  on branch: byro-repo  clean  no lease  age 0h  /w/byro-repo-issue-7-whole",
    );
  });

  it("shows a broken folder with the issue:remove command that clears it", () => {
    expect(
      workspaceLineOf({
        ...whole,
        path: "/w/session-probe",
        key: { session: "probe" },
        branch: "session-probe",
        branchedRepos: [],
        isBroken: true,
      }),
    ).toBe(
      "session probe  broken: clear it with npm run issue:remove -- --session probe  age 0h  /w/session-probe",
    );
    expect(workspaceLineOf({ ...whole, isBroken: true })).toContain(
      "npm run issue:remove -- byro-repo 7",
    );
  });
});
