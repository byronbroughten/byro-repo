import { describe, expect, it } from "vitest";

import { type StartedTicket, startReportOf } from "./startReport.ts";

const path = "/repo/.claude/worktrees/byro-repo-issue-357-slug";
const ticketText = "## Model fit (Trusted text)\n\nSonnet medium";
const ticket: StartedTicket = {
  issue: { repo: "personal", number: 357 },
  skill: "implement-code",
  spec: { repo: "personal", number: 350 },
  text: ticketText,
};
const skillLine = "Skill: /implement-code";
const started = {
  path,
  hasLease: true,
  cwd: "/repo",
  ticket,
  otherIssueBranches: [],
};

describe("startReportOf", () => {
  it("prints the path first, then the skill and the ticket text, for a fresh start", () => {
    expect(startReportOf(started)).toBe(`${path}\n${skillLine}\n${ticketText}`);
  });

  it("names the skill it is given", () => {
    const piece: StartedTicket = { ...ticket, skill: "research-piece" };
    expect(startReportOf({ ...started, ticket: piece })).toBe(
      `${path}\nSkill: /research-piece\n${ticketText}`,
    );
  });

  it("names the ticket's piece:pull command under the skill on a drafting ticket", () => {
    const drafting: StartedTicket = { ...ticket, skill: "implement-piece" };
    expect(startReportOf({ ...started, ticket: drafting })).toBe(
      [
        path,
        "Skill: /implement-piece",
        "Pull: npm run piece:pull -- personal 357",
        ticketText,
      ].join("\n"),
    );
  });

  it.each([
    ["a code ticket", "implement-code"],
    ["a Research ticket", "research-piece"],
  ] as const)("names no pull command on %s", (_kind, skill) => {
    expect(startReportOf({ ...started, ticket: { ...ticket, skill } })).toBe(
      `${path}\nSkill: /${skill}\n${ticketText}`,
    );
  });

  it("names /close-project with the spec's number, never the gate's, and no pull command on an Edit gate", () => {
    const gate: StartedTicket = { ...ticket, skill: "close-project" };
    expect(startReportOf({ ...started, ticket: gate })).toBe(
      `${path}\nSkill: /close-project personal 350\n${ticketText}`,
    );
  });

  it("says the session is already there when its cwd is the workspace or under it", () => {
    const already = `This session is already in the workspace.\n${path}\n${skillLine}\n${ticketText}`;
    expect(startReportOf({ ...started, cwd: path })).toBe(already);
    expect(startReportOf({ ...started, cwd: `${path}/scripts` })).toBe(already);
  });

  it("does not match a sibling folder that merely starts with the path", () => {
    expect(startReportOf({ ...started, cwd: `${path}-other` })).toBe(
      `${path}\n${skillLine}\n${ticketText}`,
    );
  });

  it("says no lease was taken, and is never already there, without a claude process", () => {
    expect(startReportOf({ ...started, hasLease: false, cwd: path })).toBe(
      `${path}\nNo claude process ran this, so no lease was taken.\n${skillLine}\n${ticketText}`,
    );
  });

  it("prints a line under the path for each other repo's same-numbered branch", () => {
    const otherIssueBranches = [
      { repo: "sheets-framework", branch: "issue-357-prototype" },
      { repo: "utils", branch: "issue-357-research" },
    ];
    expect(startReportOf({ ...started, otherIssueBranches })).toBe(
      [
        path,
        "sheets-framework has issue-357-prototype, another issue's branch with this number; not reused.",
        "utils has issue-357-research, another issue's branch with this number; not reused.",
        skillLine,
        ticketText,
      ].join("\n"),
    );
  });

  it("prints no skill or ticket text for a session workspace", () => {
    expect(startReportOf({ ...started, ticket: undefined })).toBe(path);
  });
});
