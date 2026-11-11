import { describe, expect, it } from "vitest";

import { resolvePrompt } from "./resolveStep.ts";

describe("resolvePrompt", () => {
  const prompt = resolvePrompt({
    issue: { repo: "byro-repo", number: 220 },
    spec: { repo: "byro-repo", number: 213 },
    title: "Finding-triage record, checker and prompt",
    labels: [],
    dismissedOverlaps: [],
    branch: "issue-220-finding-triage-record-checker-and-prompt",
    branchedRepos: ["byro-repo"],
    workspacePath: "/workspaces/byro-repo-issue-220",
    findings: [
      {
        axis: "standards",
        where: "SpecRun.ts:88",
        claim: "It has a multi-line comment.",
        suggestedVerdict: "fix",
        reason: "Smells: Multi-line comment.",
      },
      "Wrap-up isn't wired in.",
    ],
  });

  it("numbers each finding for its record, a structured one with its axis and suggested verdict, a saved prose one as it was", () => {
    expect(prompt).toContain(
      "1. [standards] SpecRun.ts:88: It has a multi-line comment. Suggested verdict: fix, Smells: Multi-line comment.\n2. Wrap-up isn't wired in.",
    );
  });

  it("asks for one record per finding and one commit for the Fixes", () => {
    expect(prompt).toContain("exactly one record per finding");
    expect(prompt).toContain("The Fixes land together in one commit");
  });

  it("halts on a spec-axis fix it can't land, and Proposes any other", () => {
    expect(prompt).toContain(
      "as a Propose `decision`, or for a `spec`-axis finding as a Halt scoped to the downstream tickets",
    );
  });

  it("names the verdict-rules doc instead of carrying its rules", () => {
    expect(prompt).toContain("`docs/agents/verdicts.md`");
    [
      "Doc drift",
      "the finding is wrong",
      "unverifiable findings",
      "would reverse a User Story",
    ].forEach((rule) => expect(prompt).not.toContain(rule));
  });

  it("lists the fields each verdict's record needs", () => {
    [
      "`serves-spec`",
      "`coveredBy`",
      "`draftKeepReason`",
      "`draftIssueTitle`",
      "`haltScope`",
    ].forEach((field) => expect(prompt).toContain(field));
  });

  it("names the issue reader for the spec read", () => {
    expect(prompt).toContain("npm run issue:read -- <repo> <n> --hide-others");
  });

  it("allows what the tier list allows in the workspace, and a blocker for a denied write", () => {
    expect(prompt).toContain(
      "- You may do what the tier list allows in your workspace. Use `git -C <dir>` rather than `cd <dir> && git`. When a write is denied, record one `denied-tool` blocker instead of trying a workaround. A refused read whose answer you got another way, or didn't need, is not a blocker: name it in your closing comment instead.",
    );
  });

  it("keeps a closing keyword away from an issue reference in a commit message", () => {
    expect(prompt).toContain(
      "- In a commit message, never put a closing keyword (`close`, `fix`, `resolve` or one of their forms) before an issue reference: GitHub would close the issue once the commit reaches master. Write `review of #512` or `for #512` instead.",
    );
  });
});
