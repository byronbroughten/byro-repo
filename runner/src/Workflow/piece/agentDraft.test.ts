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

const idDraft = `# Part one
<!-- developer h.one -->

## Intro
<!-- agent h.intro -->

Agent intro.
`;

const noIds = new Map<string, string>();

describe("agentDraft", () => {
  it("round-trips a draft with # lines unchanged", () => {
    expect(agentDraft.draftOf(agentDraft.sectionsOf(headedDraft))).toBe(
      headedDraft,
    );
  });

  it("round-trips a draft whose marks carry a headingId unchanged", () => {
    expect(agentDraft.draftOf(agentDraft.sectionsOf(idDraft))).toBe(idDraft);
  });

  it("parses a bare mark and an ID mark side by side", () => {
    const mixed =
      "# Part one\n<!-- developer -->\n\n## Intro\n<!-- agent h.intro -->\n\nText.\n";
    expect(
      agentDraft
        .sectionsOf(mixed)
        .map(({ author, headingId }) => [author, headingId]),
    ).toEqual([
      ["developer", undefined],
      ["agent", "h.intro"],
    ]);
    expect(agentDraft.draftOf(agentDraft.sectionsOf(mixed))).toBe(mixed);
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

  it("reads the agent Sections with their heading paths and headingIds for the push", () => {
    expect(
      agentDraft.agentSectionsOf(
        headedDraft.replace("<!-- agent -->", "<!-- agent h.intro -->"),
      ),
    ).toEqual([
      {
        headingPath: "Part one › Intro",
        headingId: "h.intro",
        markdown: "Agent intro one.\n",
      },
    ]);
  });

  it("gives the image folder beside the draft for a spec number", () => {
    expect(agentDraft.pathOf(10)).toBe("writing/agent-drafts/10.md");
    expect(agentDraft.imageFolderOf(10)).toBe("writing/agent-drafts/10/");
  });

  it("round-trips a draft holding Image placeholders unchanged", () => {
    const draft =
      "## Results\n<!-- agent h.results -->\n\nProse before.\n\n\\[Image 1: sales\\_by\\_month.png\\]\n\n\\[Image 2: Sales rose each month.\\]\n";
    expect(agentDraft.draftOf(agentDraft.sectionsOf(draft))).toBe(draft);
  });

  describe("pulledOf", () => {
    it("mirrors the Doc's # lines, marking each H1 and keeping agent Sections", () => {
      const doc =
        "# Part one\n\n## Intro\n\nDoc intro one.\n\n# Part two\n\n## Intro\n\nDoc intro two.\n";
      const pulled = agentDraft.draftOf(
        agentDraft.pulledOf(agentDraft.sectionsOf(headedDraft), doc, noIds),
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

    it("writes each heading's current headingId into its mark, an agent Section's included, and a bare mark gains one", () => {
      const doc =
        "# Part one\n\n## Intro\n\nDoc intro.\n\n## Other\n\nDoc other.\n";
      const pulled = agentDraft.draftOf(
        agentDraft.pulledOf(
          agentDraft.sectionsOf(idDraft),
          doc,
          new Map([
            ["Part one", "h.one"],
            ["Part one › Intro", "h.intro2"],
            ["Part one › Other", "h.other"],
          ]),
        ),
      );
      expect(pulled).toBe(`# Part one
<!-- developer h.one -->

## Intro
<!-- agent h.intro2 -->

Agent intro.

## Other
<!-- developer h.other -->

Doc other.
`);
    });

    it("keeps an agent Section the Doc no longer holds with the headingId it had", () => {
      const pulled = agentDraft.pulledOf(
        agentDraft.sectionsOf(idDraft),
        "# Part one\n",
        new Map([["Part one", "h.one"]]),
      );
      expect(pulled.map(({ path, headingId }) => [path, headingId])).toEqual([
        ["Part one", "h.one"],
        ["Part one › Intro", "h.intro"],
      ]);
    });

    it("keeps an agent Section the Doc no longer holds under its own H1", () => {
      const doc = "# Part one\n\n# Part two\n\n## Intro\n\nDoc intro two.\n";
      const pulled = agentDraft.pulledOf(
        agentDraft.sectionsOf(headedDraft),
        doc,
        noIds,
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
        agentDraft.pulledOf(agentDraft.sectionsOf(headedDraft), doc, noIds),
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
      const pulled = agentDraft.pulledOf(held, "# Part one\n\nText.\n", noIds);
      expect(pulled.map(({ path }) => path)).toEqual(["Lead", "Part one"]);
    });
  });
});
