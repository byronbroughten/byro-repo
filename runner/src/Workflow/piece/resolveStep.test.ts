import { describe, expect, it } from "vitest";

import { pieceResolvePrompt } from "./resolveStep.ts";

describe("pieceResolvePrompt", () => {
  const prompt = pieceResolvePrompt({
    issue: { repo: "personal", number: 12 },
    spec: { repo: "personal", number: 10 },
    title: "Draft the opening",
    labels: [],
    branch: "issue-12-draft",
    branchedRepos: ["personal"],
    workspacePath: "/workspace",
    findings: [],
    dismissedOverlaps: [],
    draftPath: "writing/agent-drafts/10.md",
    overlapCommand: ["npm", "run", "overlap", "--"],
  });

  it("scopes its fixes and checks to the Sections the ticket names by full heading path", () => {
    expect(prompt).toContain(
      "only the Sections this ticket names, by their full heading paths",
    );
  });

  it("asks a verdict to name a Section by its full heading path", () => {
    expect(prompt).toContain(
      "Name a Section in a verdict's `evidence` or a Propose `decision` by its full heading path, `<H1> › <H2>`.",
    );
  });
});
