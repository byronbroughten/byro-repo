import { describe, expect, it } from "vitest";

import { startReportOf } from "./startReport.ts";

const path = "/repo/.claude/worktrees/byro-repo-issue-357-slug";
const ticketText = "## Model fit (Trusted text)\n\nSonnet medium";
const started = { path, hasLease: true, cwd: "/repo", ticketText };

describe("startReportOf", () => {
  it("prints the path first, then the ticket text, for a fresh start", () => {
    expect(startReportOf(started)).toBe(`${path}\n${ticketText}`);
  });

  it("says the session is already there when its cwd is the workspace or under it", () => {
    const already = `This session is already in the workspace.\n${path}\n${ticketText}`;
    expect(startReportOf({ ...started, cwd: path })).toBe(already);
    expect(startReportOf({ ...started, cwd: `${path}/scripts` })).toBe(already);
  });

  it("does not match a sibling folder that merely starts with the path", () => {
    expect(startReportOf({ ...started, cwd: `${path}-other` })).toBe(
      `${path}\n${ticketText}`,
    );
  });

  it("says no lease was taken, and is never already there, without a claude process", () => {
    expect(startReportOf({ ...started, hasLease: false, cwd: path })).toBe(
      `${path}\nNo claude process ran this, so no lease was taken.\n${ticketText}`,
    );
  });

  it("prints no ticket text for a session workspace", () => {
    expect(startReportOf({ ...started, ticketText: undefined })).toBe(path);
  });
});
