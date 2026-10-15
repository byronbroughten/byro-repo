import { describe, expect, it } from "vitest";

import { reviewPrompt } from "./reviewStep.ts";

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
