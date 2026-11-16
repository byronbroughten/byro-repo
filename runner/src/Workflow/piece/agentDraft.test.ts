import { describe, expect, it } from "vitest";

import { agentDraft } from "./agentDraft.ts";

const headedDraft = `# Part one
<!-- developer -->

## Intro
<!-- agent -->

Agent intro one.

# Part two
<!-- developer -->

Part two's own text.

## Intro
<!-- developer -->

Developer intro two.
`;

describe("agentDraft", () => {
  it("round-trips a draft with # lines unchanged", () => {
    expect(agentDraft.draftOf(agentDraft.sectionsOf(headedDraft))).toBe(
      headedDraft,
    );
  });

  it("names each Section by its heading path", () => {
    expect(
      agentDraft
        .sectionsOf(headedDraft)
        .map(({ path, author }) => [path, author]),
    ).toEqual([
      ["Part one", "developer"],
      ["Part one › Intro", "agent"],
      ["Part two", "developer"],
      ["Part two › Intro", "developer"],
    ]);
  });

  it("parses a legacy draft with no # lines as today", () => {
    const legacy =
      "## Intro\n<!-- agent -->\n\nText.\n\n## End\n<!-- developer -->\n";
    expect(
      agentDraft
        .sectionsOf(legacy)
        .map(({ path, markdown }) => [path, markdown]),
    ).toEqual([
      ["Intro", "Text.\n"],
      ["End", "\n"],
    ]);
    expect(agentDraft.draftOf(agentDraft.sectionsOf(legacy))).toBe(legacy);
  });

  it("reads the agent Sections by heading path for the push", () => {
    expect([...agentDraft.agentSectionsOf(headedDraft)]).toEqual([
      ["Part one › Intro", "Agent intro one.\n"],
    ]);
  });

  describe("pulledOf", () => {
    it("mirrors the Doc's # lines, marking each H1 and keeping agent Sections", () => {
      const doc =
        "# Part one\n\n## Intro\n\nDoc intro one.\n\n# Part two\n\n## Intro\n\nDoc intro two.\n";
      const pulled = agentDraft.draftOf(
        agentDraft.pulledOf(agentDraft.sectionsOf(headedDraft), doc),
      );
      expect(pulled).toBe(`# Part one
<!-- developer -->

## Intro
<!-- agent -->

Agent intro one.

# Part two
<!-- developer -->

## Intro
<!-- developer -->

Doc intro two.
`);
    });

    it("keeps an agent Section the Doc no longer holds under its own H1", () => {
      const doc = "# Part one\n\n# Part two\n\n## Intro\n\nDoc intro two.\n";
      const pulled = agentDraft.pulledOf(
        agentDraft.sectionsOf(headedDraft),
        doc,
      );
      expect(pulled.map(({ path }) => path)).toEqual([
        "Part one",
        "Part one › Intro",
        "Part two",
        "Part two › Intro",
      ]);
    });

    it("adds an empty developer H1 for an agent Section whose H1 the Doc no longer holds", () => {
      const doc = "# Part two\n\n## Intro\n\nDoc intro two.\n";
      const draft = agentDraft.draftOf(
        agentDraft.pulledOf(agentDraft.sectionsOf(headedDraft), doc),
      );
      expect(agentDraft.sectionsOf(draft).map(({ path }) => path)).toEqual([
        "Part two",
        "Part two › Intro",
        "Part one",
        "Part one › Intro",
      ]);
    });

    it("keeps a gone H2 from before any H1 ahead of the first H1", () => {
      const held = agentDraft.sectionsOf(
        "## Lead\n<!-- agent -->\n\nAgent lead.\n",
      );
      const pulled = agentDraft.pulledOf(held, "# Part one\n\nText.\n");
      expect(pulled.map(({ path }) => path)).toEqual(["Lead", "Part one"]);
    });
  });
});
