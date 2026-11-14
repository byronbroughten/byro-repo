import { describe, expect, it } from "vitest";

import { gapCheckPrompt } from "./gapCheck.ts";

describe("gapCheckPrompt", () => {
  const prompt = gapCheckPrompt({
    spec: { repo: "byro-repo", number: 213 },
    title: "The spec",
    tickets: [
      {
        issue: { repo: "byro-repo", number: 229 },
        title: "Review list",
        isOpen: false,
      },
    ],
  });

  it("skips every story or section an addendum drops, and names no Phases", () => {
    expect(prompt).toContain("every story or section an addendum drops");
    expect(prompt).not.toContain("Phase");
  });

  it("lists the spec's tickets and changes nothing", () => {
    expect(prompt).toContain('- byro-repo #229, "Review list"');
    expect(prompt).toContain("Change nothing");
  });
});
