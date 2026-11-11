import { describe, expect, it } from "vitest";

import { pieceGapCheckPrompt } from "./gapCheck.ts";

describe("pieceGapCheckPrompt", () => {
  const prompt = pieceGapCheckPrompt({
    spec: { repo: "personal", number: 58 },
    title: "The crossing",
    tickets: [
      {
        issue: { repo: "personal", number: 60 },
        title: "Draft The crossing",
        isOpen: false,
      },
      {
        issue: { repo: "personal", number: 61 },
        title: "Edit the crossing",
        isOpen: true,
      },
    ],
    draftPath: "writing/agent-drafts/58.md",
  });

  it("checks the Agent draft for what no review checks, a ticket closed as not planned included", () => {
    expect(prompt).toContain("`writing/agent-drafts/58.md`");
    expect(prompt).toContain("Check only what no review checks");
    expect(prompt).toContain("a ticket closed as not planned drafted nothing");
  });

  it("lists the spec's tickets, the Edit gate as open, and changes nothing", () => {
    expect(prompt).toContain(
      '- personal #60, "Draft The crossing"\n- personal #61, "Edit the crossing" (open: the Edit gate)',
    );
    expect(prompt).toContain("Change nothing");
  });
});
