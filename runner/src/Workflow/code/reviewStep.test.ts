import { Ajv } from "ajv";
import { describe, expect, it } from "vitest";

import { reviewPrompt, reviewRecordSchema } from "./reviewStep.ts";

describe("reviewPrompt", () => {
  it("names the issue reader for the spec read", () => {
    const prompt = reviewPrompt({
      issue: { repo: "byro-repo", number: 269 },
      title: "Runner steps read issues only through the reader",
      skillName: "code-review",
      branch: "issue-269-reader-only-issues",
      branchedRepos: ["byro-repo"],
    });
    expect(prompt).toContain(
      "Read issues only through the issue reader, `npm run issue:read -- <repo> <n> --hide-others`",
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
});
