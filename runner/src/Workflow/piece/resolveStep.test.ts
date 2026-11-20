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

  it("lets a fix touch the agent's own images in the image folder, those with an SVG source beside them", () => {
    expect(prompt).toContain(
      "A fix touches only the Agent draft and only the Sections this ticket names, by their full heading paths, and the agent's own images in the image folder, `writing/agent-drafts/10/`, those with an SVG source beside them: never a Section marked `<!-- developer -->`, an image with no SVG source beside it, the spec, the fact list or a Research comment.",
    );
  });

  it("commits the image folder's files beside the Agent draft", () => {
    expect(prompt).toContain(
      "Commit the Fixes, to the Agent draft and the image folder's files only, on the ticket's branch, separate from the implement commit: `git -C <clone> add writing/agent-drafts/10.md` in the `personal` clone, `git -C <clone> add writing/agent-drafts/10/` when you added or changed an image there, then `git -C <clone> commit`.",
    );
  });

  it("asks a verdict to name a Section by its full heading path", () => {
    expect(prompt).toContain(
      "Name a Section in a verdict's `evidence` or a Propose `decision` by its full heading path, `<H1> › <H2>`.",
    );
  });
});
