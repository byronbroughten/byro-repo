import { describe, expect, it } from "vitest";

import { heldTicketLinesOf } from "../../promptText.ts";
import {
  pieceReviewerCheckOf,
  pieceReviewPrompt,
  type PieceReviewPromptInput,
} from "./reviewStep.ts";

const skillText = `---
name: review-piece
description: "Review a writing Piece's Agent draft on three axes."
disable-model-invocation: true
---

Three-axis review of a Piece's Agent draft.

## 1. Pin the issue and its scope
`;

describe("pieceReviewPrompt", () => {
  const input: PieceReviewPromptInput = {
    issue: { repo: "byro-repo", number: 12 },
    spec: { repo: "byro-repo", number: 10 },
    title: "Draft the harbour",
    labels: ["ready-for-agent", "section:The harbour"],
    skillName: "review-piece",
    skillText,
    branch: "issue-12-draft-the-harbour",
    branchedRepos: ["byro-repo"],
    workspacePath: "/workspaces/byro-repo-issue-12",
    isInlineAllowed: false,
    draftPath: "docs/pieces/drafts/10.md",
  };

  it("carries the skill's body without its frontmatter, never sending the agent to the Skill tool or the skill's path", () => {
    const prompt = pieceReviewPrompt(input);

    expect(prompt).toContain(
      '<skill name="review-piece">\nThree-axis review of a Piece\'s Agent draft.\n\n## 1. Pin the issue and its scope',
    );
    expect(prompt).not.toContain("description:");
    expect(prompt).not.toContain("disable-model-invocation");
    expect(prompt).not.toContain("Skill tool");
    expect(prompt).not.toContain("SKILL.md");
    expect(prompt).not.toContain("by that path");
  });

  it("keeps the Agent draft, image folder, passages folder, scope and return lines", () => {
    const prompt = pieceReviewPrompt(input);

    expect(prompt).toContain(
      'Review byro-repo#12, "Draft the harbour", on the `spec`, `standards` and `reader` axes, by the `review-piece` skill below.',
    );
    expect(prompt).toContain(
      "The draft input is the Agent draft, `docs/pieces/drafts/10.md` in the `byro-repo` clone, its image folder, `writing/agent-drafts/10/` in the same clone, and the passages folder, `/workspaces/byro-repo-issue-12/.runner/passages/byro-repo-12`; the ticket's spec is byro-repo#10.",
    );
    expect(prompt).toContain("The in-scope text is");
    expect(prompt).toContain("`dismissedOverlaps`: each overlap hit");
    expect(prompt.indexOf("</skill>")).toBeLessThan(
      prompt.indexOf("`dismissedOverlaps`: each overlap hit"),
    );
  });

  it("asks a finding to name its Section by its full heading path", () => {
    expect(pieceReviewPrompt(input)).toContain(
      "its Section's full heading path (`<H1> › <H2>`)",
    );
  });

  it("tells only a session that holds the ticket not to re-read it, before the skill", () => {
    const heldTicketLine = heldTicketLinesOf(true).join("");
    const held = pieceReviewPrompt({ ...input, isTicketHeld: true });

    expect(held).toContain(heldTicketLine);
    expect(held.indexOf(heldTicketLine)).toBeLessThan(held.indexOf("<skill"));
    expect(pieceReviewPrompt(input)).not.toContain(heldTicketLine);
  });

  it("has no commit list, since the review has no diff and no fixed point", () => {
    expect(pieceReviewPrompt(input)).not.toContain("commits since");
  });

  it("names each supplied input's file before the skill, saying which the spec lacks", () => {
    const folder =
      "/workspaces/byro-repo-issue-12/.runner/review-inputs/byro-repo-12";
    const prompt = pieceReviewPrompt({
      ...input,
      suppliedInputs: [
        { name: "Reader", path: `${folder}/reader.md` },
        { name: "Outline", path: `${folder}/outline.md` },
        {
          name: "Length limit",
          absence: "the spec's Form field has no `Length:` line",
        },
        { name: "Overlap", path: `${folder}/overlap.txt` },
      ],
    });

    const supplied = `the Reader file, \`${folder}/reader.md\`; the Outline file, \`${folder}/outline.md\`; the Overlap file, \`${folder}/overlap.txt\`.`;
    expect(prompt).toContain(supplied);
    expect(prompt).toContain(
      "No Length limit file: the spec's Form field has no `Length:` line.",
    );
    expect(prompt).toContain("use each as given");
    expect(prompt.indexOf(supplied)).toBeLessThan(prompt.indexOf("<skill"));
    expect(prompt).not.toContain("length-limit");
  });

  it("supplies no input when its caller names none", () => {
    expect(pieceReviewPrompt(input)).not.toContain("use each as given");
  });
});

describe("pieceReviewerCheckOf", () => {
  it("sends back a review that skipped its reviewers by the skill's name, never its path, and never offers inline review", () => {
    const check = pieceReviewerCheckOf("review-piece");

    expect(check.count).toBe(3);
    expect(check.offerInline).toBe(false);
    expect(check.resumePrompt).toContain(
      'all three, the spec, standards and reader reviewers, as the "review-piece" skill says: three Agent calls in one message',
    );
    expect(check.resumePrompt).not.toContain("SKILL.md");
  });
});
