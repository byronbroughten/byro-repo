import { Ajv } from "ajv";
import { describe, expect, it } from "vitest";

import type { ReviewPromptInput } from "../../Workflow.ts";
import { reviewPrompt, reviewRecordSchema } from "./reviewStep.ts";

describe("reviewPrompt", () => {
  const input: ReviewPromptInput = {
    issue: { repo: "byro-repo", number: 269 },
    spec: { repo: "byro-repo", number: 268 },
    title: "Runner steps read issues only through the reader",
    labels: ["ready-for-agent"],
    skillName: "code-review",
    branch: "issue-269-reader-only-issues",
    branchedRepos: ["byro-repo"],
    workspacePath: "/workspaces/byro-repo-issue-269",
    isInlineAllowed: false,
  };
  const briefLine = "paste it into both reviewers' briefs";

  it("names the issue reader for the spec read", () => {
    expect(reviewPrompt(input)).toContain(
      "Read issues only through the issue reader, `npm run issue:read -- <repo> <n> --hide-others`",
    );
  });

  it("hands the implementer's points worth checking to both reviewers' briefs, as things to check", () => {
    const prompt = reviewPrompt({
      ...input,
      pointsWorthChecking: [
        "runner/src/SpecRun.ts: the relaunch branch still computes warnings",
        "the reader's --hide-others flag",
      ],
    });
    expect(prompt).toContain(
      "## The implementer's points worth checking\n\n- runner/src/SpecRun.ts: the relaunch branch still computes warnings\n- the reader's --hide-others flag",
    );
    expect(prompt).toContain(
      `${briefLine}, Standards and Spec alike, as things to check, not as findings`,
    );
  });

  it("says nothing of points worth checking when the implementer named none", () => {
    expect(reviewPrompt(input)).not.toContain(briefLine);
    expect(reviewPrompt({ ...input, pointsWorthChecking: [] })).toBe(
      reviewPrompt(input),
    );
  });

  it("allows an inline review only for a diff within the inline size", () => {
    expect(reviewPrompt(input)).not.toContain("may review it inline");
    expect(reviewPrompt({ ...input, isInlineAllowed: true })).toContain(
      "may review it inline",
    );
  });
});

describe("reviewRecordSchema", () => {
  const isValid = new Ajv().compile(reviewRecordSchema);
  const finding = {
    axis: "spec",
    where: "SpecRun.ts:88",
    claim: "It skips the resolve step.",
    suggestedVerdict: "halt",
    reason: "The spec reads both ways.",
  };

  it("takes an empty list and a finding with its axis, where, claim, suggested verdict and reason", () => {
    expect(isValid({ findings: [] })).toBe(true);
    expect(isValid({ findings: [finding] })).toBe(true);
  });

  it("refuses a prose finding and one missing its axis", () => {
    const { axis: _axis, ...noAxis } = finding;
    expect(
      isValid({ findings: ["SpecRun.ts:88 skips the resolve step."] }),
    ).toBe(false);
    expect(isValid({ findings: [noAxis] })).toBe(false);
  });

  it("refuses a reader finding, which only a piece review makes", () => {
    expect(isValid({ findings: [{ ...finding, axis: "reader" }] })).toBe(false);
  });
});
