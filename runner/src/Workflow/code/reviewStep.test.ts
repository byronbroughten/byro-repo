import { Ajv } from "ajv";
import { describe, expect, it } from "vitest";

import {
  type CodeReviewPromptInput,
  reviewPrompt,
  reviewRecordSchema,
} from "./reviewStep.ts";

const skillText = `---
name: code-review
description: "Review the changes since a fixed point."
---

Two-axis review of the diff.

### 1. Pin the fixed point

The prose rules file, [\`docs/prose-style.md\`](../../../docs/prose-style.md), and [its agents](./agents/standards.md#brief), [a site](https://example.com/a.md) and [a heading](#process) stay.
`;

describe("reviewPrompt", () => {
  const input: CodeReviewPromptInput = {
    issue: { repo: "byro-repo", number: 269 },
    spec: { repo: "byro-repo", number: 268 },
    title: "Runner steps read issues only through the reader",
    labels: ["ready-for-agent"],
    skillName: "code-review",
    skillText,
    branch: "issue-269-reader-only-issues",
    branchedRepos: ["byro-repo", "framework"],
    workspacePath: "/workspaces/byro-repo-issue-269",
    isInlineAllowed: false,
  };
  const briefLine = "paste it into both reviewers' briefs";
  const heldTicketLine = "This session already holds the ticket";
  const fixedPointLine =
    "The fixed point is `master`: it resolves and the diff is non-empty, so the skill's step 1 is done.";

  it("carries the skill's body without its frontmatter, never sending the agent to the Skill tool or the skill's path", () => {
    const prompt = reviewPrompt(input);

    expect(prompt).toContain(
      '<skill name="code-review">\nTwo-axis review of the diff.\n\n### 1. Pin the fixed point',
    );
    expect(prompt).not.toContain("description:");
    expect(prompt).not.toContain("Skill tool");
    expect(prompt).not.toContain("SKILL.md");
  });

  it("pins `master` as the fixed point and lists each branched repo's commits since it", () => {
    const prompt = reviewPrompt({
      ...input,
      commitsSinceMaster: [
        {
          repo: "byro-repo",
          commits: ["abc1234 Add one.ts", "def5678 Fix it"],
        },
        { repo: "framework", commits: [] },
      ],
    });

    expect(prompt).toContain(
      `${fixedPointLine} Each repo's diff is \`git diff master...HEAD\` in its clone; its commits since \`master\`:\n\n- \`byro-repo\`:\n  - abc1234 Add one.ts\n  - def5678 Fix it\n- \`framework\`: none`,
    );
  });

  it("leaves the fixed point to the skill's step 1 when no branched repo has a diff", () => {
    const prompt = reviewPrompt(input);

    expect(prompt).not.toContain("it resolves and the diff is non-empty");
    expect(prompt).not.toContain("commits since `master`");
    expect(prompt).toContain("with `master` as the fixed point");
  });

  it("names the issue reader for the spec read", () => {
    expect(reviewPrompt(input)).toContain(
      "Read issues only through the issue reader, `npm run issue:read -- <repo> <n> --hide-others`",
    );
  });

  it("tells only a session that holds the ticket not to re-read it, leaving the spec reviewer's own read", () => {
    const held = reviewPrompt({ ...input, isTicketHeld: true });

    expect(held).toContain(heldTicketLine);
    expect(held).toContain("The spec reviewer still reads it itself");
    expect(reviewPrompt(input)).not.toContain(heldTicketLine);
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

  it("words the implementer's review of its own work, asking for every finding as its reviewer worded it", () => {
    const prompt = reviewPrompt(input);
    expect(prompt).toContain("your own work");
    expect(prompt).toContain("each as its reviewer worded it");
    expect(prompt).toContain("Change nothing");
  });

  describe("an interactive session's brief", () => {
    const sessionSubmit = {
      recordPath: ".runner/review-269.json",
      command:
        "npm run runner -- review byro-repo-owner/byro-repo 269 .runner/review-269.json --session <id>",
    };
    const prompt = reviewPrompt({ ...input, sessionSubmit });

    it("words the session's review of its own work, never saying nobody is watching", () => {
      expect(prompt).toContain("in this interactive session");
      expect(prompt).toContain("your own work");
      expect(prompt).not.toContain("Nobody is watching");
    });

    it("has the session paste its own points worth checking into every reviewer's brief", () => {
      expect(prompt).toContain(
        "You have no committed implement record, so the points worth checking are yours to name",
      );
      expect(prompt).toContain("paste them into every reviewer's brief");
    });

    it("has it write the record to its file and submit it, naming where its session id is", () => {
      expect(prompt).toContain(
        "Write the review record to `.runner/review-269.json`, a JSON object holding only `findings`, then submit it with `npm run runner -- review byro-repo-owner/byro-repo 269 .runner/review-269.json --session <id>`, taking the id from the `session: <id>` line in your context.",
      );
      expect(prompt).not.toContain("Return `output`");
      expect(prompt).toContain("each as its reviewer worded it");
    });
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
