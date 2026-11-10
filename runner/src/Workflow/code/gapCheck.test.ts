import { describe, expect, it } from "vitest";

import { gapCheckPrompt } from "./gapCheck.ts";

describe("gapCheckPrompt", () => {
  const prompt = gapCheckPrompt({
    spec: { repo: "byro-repo", number: 213 },
    title: "The spec",
    tickets: [
      { issue: { repo: "byro-repo", number: 229 }, title: "Review list" },
    ],
  });

  it("skips dropped Phases and the stories an addendum drops", () => {
    expect(prompt).toContain(
      "the stories of every Phase its `## Phases` section, in the body or an addendum, marks `dropped`, and every story or section an addendum drops",
    );
  });

  it("lists the spec's tickets and changes nothing", () => {
    expect(prompt).toContain('- byro-repo #229, "Review list"');
    expect(prompt).toContain("Change nothing");
  });
});
