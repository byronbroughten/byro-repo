import { describe, expect, it } from "vitest";

import { GapCheckPrompt } from "../../promptText/GapCheckPrompt.ts";
import { pieceGapCheckSectionOf } from "./gapCheck.ts";

describe("a piece-only spec's gap-check prompt", () => {
  const prompt = GapCheckPrompt.init({
    spec: { repo: "personal", number: 58 },
    title: "The crossing",
    tickets: [
      {
        issue: { repo: "personal", number: 60 },
        title: "Draft The crossing",
        isOpen: false,
        workflow: "piece",
      },
      {
        issue: { repo: "personal", number: 61 },
        title: "Edit the crossing",
        isOpen: true,
        workflow: "piece",
      },
    ],
    sections: [pieceGapCheckSectionOf("writing/agent-drafts/58.md")],
  }).text;

  it("checks the Agent draft for what no review checks, a ticket closed as not planned included", () => {
    expect(prompt).toContain("`writing/agent-drafts/58.md`");
    expect(prompt).toContain("Check only what no review checks");
    expect(prompt).toContain("a ticket closed as not planned drafted nothing");
    expect(prompt).toContain("against the Agent draft.");
  });

  it("runs past the Edit gate, and never touches the Deliverable's Doc", () => {
    expect(prompt).toContain(
      "has landed or closed, but the Edit gate, the developer's `edit-gate` ticket to edit the Deliverable.",
    );
    expect(prompt).toContain("Never read or write the Deliverable's Doc.");
  });

  it("drafts a drafting ticket for each gap, and holds no code wording", () => {
    expect(prompt).toContain(
      "the title of a drafting ticket that would close it",
    );
    expect(prompt).not.toContain("follow-up issue");
    expect(prompt).not.toContain("code tickets");
  });

  it("lists the spec's tickets with their Workflow, the Edit gate as open, and changes nothing", () => {
    expect(prompt).toContain(
      '- personal #60, "Draft The crossing" (piece)\n- personal #61, "Edit the crossing" (piece; open: the Edit gate)',
    );
    expect(prompt).toContain("Change nothing");
  });
});
