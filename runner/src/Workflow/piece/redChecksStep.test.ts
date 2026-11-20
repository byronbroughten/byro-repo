import { describe, expect, it } from "vitest";

import { pieceRedChecksPrompt } from "./redChecksStep.ts";

describe("pieceRedChecksPrompt", () => {
  const prompt = pieceRedChecksPrompt({
    issue: { repo: "personal", number: 12 },
    spec: { repo: "personal", number: 10 },
    title: "Draft the opening",
    labels: [],
    branch: "issue-12-draft",
    branchedRepos: ["personal"],
    workspacePath: "/workspace",
    failures: "The Agent draft's Sections are 12 words.",
    draftPath: "writing/agent-drafts/10.md",
  });

  it("commits only the Agent draft and its image folder's files", () => {
    expect(prompt).toContain(
      "Commit only the Agent draft and the image folder's files, on the ticket's branch: `git -C <clone> add writing/agent-drafts/10.md` in the `personal` clone, `git -C <clone> add writing/agent-drafts/10/` when you changed an image there, then `git -C <clone> commit`.",
    );
  });
});
