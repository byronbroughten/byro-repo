import { describe, expect, it } from "vitest";

import { GapCheckPrompt } from "../../promptText/GapCheckPrompt.ts";
import { codeGapCheckSection } from "./gapCheck.ts";

describe("a code-only spec's gap-check prompt", () => {
  const prompt = GapCheckPrompt.init({
    spec: { repo: "byro-repo", number: 213 },
    title: "The spec",
    tickets: [
      {
        issue: { repo: "byro-repo", number: 229 },
        title: "Review list",
        isOpen: false,
        workflow: "code",
      },
    ],
    sections: [codeGapCheckSection],
  }).text;

  it("checks each story and Implementation Decision against master, a ticket closed as not planned included", () => {
    expect(prompt).toContain(
      "Each User Story and each Implementation Decision is something the spec asks for",
    );
    expect(prompt).toContain("## The code tickets' work: master");
    expect(prompt).toContain("a ticket closed as not planned landed nothing");
    expect(prompt).toContain(
      "A gap is something the spec still asks for that the work doesn't give.",
    );
    expect(prompt).toContain("against master.");
  });

  it("skips every story or section an addendum drops, and names no Phases", () => {
    expect(prompt).toContain("an addendum the developer posted as a comment");
    expect(prompt).toContain("every story or section an addendum drops");
    expect(prompt).not.toContain("Phase");
  });

  it("drafts a follow-up issue for each gap, and holds no piece wording", () => {
    expect(prompt).toContain(
      "the title of a follow-up issue that would close it",
    );
    expect(prompt).not.toContain("Agent draft");
    expect(prompt).not.toContain("Edit gate");
  });

  it("lists the spec's tickets with their Workflow, and changes nothing", () => {
    expect(prompt).toContain('- byro-repo #229, "Review list" (code)');
    expect(prompt).toContain(
      "Change nothing: no edits, commits, comments or issues.",
    );
  });
});
