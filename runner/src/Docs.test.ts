import { readdirSync, readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import { Docs } from "./Docs.ts";
import { fixtureDocument } from "./Docs/docFixtures.ts";
import { FakeDocuments } from "./Docs/FakeDocuments.ts";
import type { StructuralElement } from "./Docs/googleDocs.ts";
import { PendingSuggestions } from "./Docs/PendingSuggestions.ts";
import { StaleRevision } from "./Docs/StaleRevision.ts";

function docsOf(...fixtures: string[]): Docs {
  return Docs.init(new FakeDocuments(fixtures.map(fixtureDocument)));
}

describe("Docs.read", () => {
  it("reads a Doc as its Markdown, its Sections by heading and the revision it read", async () => {
    const read = await docsOf("lists", "headings").read("doc-headings");

    expect(read.revisionId).toBe("rev-headings-1");
    expect(read.markdown.startsWith("# A Field Guide to Kettles\n")).toBe(true);
    expect([...read.sections]).toEqual([
      [
        "Why kettles",
        "A kettle boils water faster than a pan.\n\n### Spouts\n\nMost spouts face away.\n",
      ],
      ["Which kettle", "Buy the one with a whistle.\n"],
    ]);
  });

  it("keeps a Section's footnote definitions in that Section", async () => {
    const read = await docsOf("footnotes").read("doc-footnotes");

    expect(read.sections.get("Rinsing")).toBe(
      "Rinse twice[^3].\n\n[^3]: Cold water.\n",
    );
  });

  it("refuses a Doc whose Sections share a heading", async () => {
    const document = fixtureDocument("headings");
    const twin = document.body?.content[2];
    if (twin !== undefined) {
      document.body?.content.push(twin);
    }
    const docs = Docs.init(new FakeDocuments([document]));

    await expect(docs.read("doc-headings")).rejects.toThrow(
      'Two Sections share the heading "Why kettles".',
    );
  });

  it("refuses a Doc it does not hold", async () => {
    await expect(docsOf("headings").read("doc-missing")).rejects.toThrow(
      "No Doc doc-missing.",
    );
  });
});

describe("Docs.writeSection", () => {
  async function writableDocs(): Promise<{
    docs: Docs;
    documents: FakeDocuments;
  }> {
    const documents = new FakeDocuments([fixtureDocument("writable")]);
    const docs = Docs.init(documents);
    await docs.read("doc-writable");
    return { docs, documents };
  }

  it("writes a Section that reads back as the Markdown pushed", async () => {
    const { docs } = await writableDocs();
    const markdown =
      "Kettles **boil** *water* ***fast***, as [the guide](https://example.com/kettles) says.\n\n" +
      "### Lids\n\n" +
      "A lid keeps the heat in.\n\n" +
      "### Spouts\n\n" +
      "Spouts face away from the handle.\n";

    await docs.writeSection({
      documentId: "doc-writable",
      heading: "Boiling",
      markdown,
    });

    const read = await docs.read("doc-writable");
    expect(read.sections.get("Boiling")).toBe(markdown);
    expect(read.sections.get("Pouring")).toBe("Pour slowly.\n");
    expect(read.markdown.startsWith("# Kettle Notes\n\n## Boiling\n")).toBe(
      true,
    );
  });

  it("leaves unchanged paragraphs, and unchanged text in a changed one, untouched", async () => {
    const { docs, documents } = await writableDocs();
    const before = (await documents.documentOf("doc-writable")).body?.content;

    await docs.writeSection({
      documentId: "doc-writable",
      heading: "Boiling",
      markdown:
        "Kettles heat water fast.\n\nSteam rises.\n\n### Spouts\n\nMost spouts face away.\n",
    });

    const after = (await documents.documentOf("doc-writable")).body?.content;
    expect(after?.slice(0, 3)).toEqual(before?.slice(0, 3));
    expect(after?.[3]?.paragraph?.elements).toMatchObject([
      { textRun: { content: "Kettles", textStyle: { underline: true } } },
      { textRun: { content: " heat " } },
      { textRun: { content: "water", textStyle: { underline: true } } },
      { textRun: { content: " fast.\n" } },
    ]);
    expect(after?.slice(4)).toEqual(before?.slice(4));
  });

  it("keeps every unchanged heading's headingId", async () => {
    const { docs, documents } = await writableDocs();

    await docs.writeSection({
      documentId: "doc-writable",
      heading: "Boiling",
      markdown:
        "Steam rises from the spout.\n\n### Spouts\n\nSpouts face away.\n\nA second paragraph.\n\n### Handles\n\nHold the handle.\n",
    });

    const read = await docs.read("doc-writable");
    expect(read.sections.get("Boiling")).toBe(
      "Steam rises from the spout.\n\n### Spouts\n\nSpouts face away.\n\nA second paragraph.\n\n### Handles\n\nHold the handle.\n",
    );
    const headingIds = (
      await documents.documentOf("doc-writable")
    ).body?.content.flatMap(
      (element) => element.paragraph?.paragraphStyle?.headingId ?? [],
    );
    expect(headingIds).toEqual(
      expect.arrayContaining(["h.boiling", "h.spouts", "h.pouring"]),
    );
  });

  it("appends to and empties the Doc's last Section", async () => {
    const { docs } = await writableDocs();

    await docs.writeSection({
      documentId: "doc-writable",
      heading: "Pouring",
      markdown: "Pour slowly.\n\nThen wait.\n\n### Spills\n\nWipe them.\n",
    });
    expect((await docs.read("doc-writable")).sections.get("Pouring")).toBe(
      "Pour slowly.\n\nThen wait.\n\n### Spills\n\nWipe them.\n",
    );
    await docs.writeSection({
      documentId: "doc-writable",
      heading: "Pouring",
      markdown: "Pour slowly.\n",
    });

    const read = await docs.read("doc-writable");
    expect(read.sections.get("Pouring")).toBe("Pour slowly.\n");
    expect(read.sections.get("Boiling")).toBe(
      "Kettles boil water fast.\n\nSteam rises.\n\n### Spouts\n\nMost spouts face away.\n",
    );
  });

  it("links to a heading in the same Doc", async () => {
    const { docs, documents } = await writableDocs();

    await docs.writeSection({
      documentId: "doc-writable",
      heading: "Pouring",
      markdown: "Pour once it [boils](#boiling).\n",
    });

    const read = await docs.read("doc-writable");
    expect(read.sections.get("Pouring")).toBe(
      "Pour once it [boils](#boiling).\n",
    );
    const link = (await documents.documentOf("doc-writable")).body?.content
      .at(-1)
      ?.paragraph?.elements.find((element) => element.textRun?.textStyle?.link)
      ?.textRun?.textStyle?.link;
    expect(link).toEqual({ heading: { id: "h.boiling" } });
  });

  it("refuses a write on a revision the developer has since edited, leaving their edit", async () => {
    const { docs, documents } = await writableDocs();
    const { revisionId } = await documents.documentOf("doc-writable");
    await documents.batchUpdate("doc-writable", {
      requests: [{ insertText: { text: "Hot. ", location: { index: 39 } } }],
      writeControl: { requiredRevisionId: revisionId },
    });
    const edited = await documents.documentOf("doc-writable");

    await expect(
      docs.writeSection({
        documentId: "doc-writable",
        heading: "Boiling",
        markdown: "Kettles whistle.\n",
      }),
    ).rejects.toThrow(new StaleRevision("doc-writable", revisionId));
    expect(await documents.documentOf("doc-writable")).toEqual(edited);
  });

  it("edits after a character Docs counts as two indices", async () => {
    const { docs, documents } = await writableDocs();
    await docs.writeSection({
      documentId: "doc-writable",
      heading: "Boiling",
      markdown:
        "Kettles 🫖 boil water fast.\n\nSteam rises.\n\n### Spouts\n\nMost spouts face away.\n",
    });
    await docs.read("doc-writable");

    const markdown =
      "Kettles 🫖 boil **water** quickly.\n\nSteam rises.\n\n### Spouts\n\nMost spouts face away.\n";
    await docs.writeSection({
      documentId: "doc-writable",
      heading: "Boiling",
      markdown,
    });

    expect((await docs.read("doc-writable")).sections.get("Boiling")).toBe(
      markdown,
    );
    const elements = (await documents.documentOf("doc-writable")).body
      ?.content[3]?.paragraph?.elements;
    expect(elements?.[0]?.textRun).toEqual({
      content: "Kettles",
      textStyle: { underline: true },
    });
  });

  it("writes new paragraphs with no style beyond the Markdown's", async () => {
    const { docs, documents } = await writableDocs();

    await docs.writeSection({
      documentId: "doc-writable",
      heading: "Boiling",
      markdown:
        "Fill the kettle.\n\nKettles boil water fast.\n\nSteam rises.\n\n### Spouts\n\nMost spouts face away.\n",
    });

    const content = (await documents.documentOf("doc-writable")).body?.content;
    expect(
      content?.[3]?.paragraph?.elements.map(({ textRun }) => textRun),
    ).toEqual([{ content: "Fill the kettle.\n" }]);
    expect(content?.[4]?.paragraph?.elements[0]?.textRun).toEqual({
      content: "Kettles",
      textStyle: { underline: true },
    });
  });

  it("writes bulleted and numbered lists that read back as written", async () => {
    const { docs, documents } = await writableDocs();
    const markdown =
      "Kettles boil water fast.\n\n" +
      "- Fill it\n- Boil it\n\n" +
      "Steam rises.\n\n" +
      "1. Lift the lid\n2. Pour\n1. Rinse\n\n" +
      "### Spouts\n\n" +
      "Most spouts face away.\n";

    await docs.writeSection({
      documentId: "doc-writable",
      heading: "Boiling",
      markdown,
    });

    expect((await docs.read("doc-writable")).sections.get("Boiling")).toBe(
      markdown,
    );
    const texts = (
      await documents.documentOf("doc-writable")
    ).body?.content.flatMap(({ paragraph }) =>
      paragraph === undefined
        ? []
        : [paragraph.elements.map(({ textRun }) => textRun?.content).join("")],
    );
    expect(texts?.slice(texts.indexOf("Rinse\n"), -3)).toEqual([
      "Rinse\n",
      "Spouts\n",
    ]);
  });

  it("writes a table mid-Section and at the Doc's end, each cell one paragraph", async () => {
    const { docs, documents } = await writableDocs();
    const table = "| Kettle | Litres |\n| --- | --- |\n| Steel | 1.7 |";
    const boiling = `Kettles boil water fast.\n\n${table}\n\nSteam rises.\n\n### Spouts\n\nMost spouts face away.\n`;
    const pouring = `Pour slowly.\n\n${table}\n`;

    await docs.writeSection({
      documentId: "doc-writable",
      heading: "Boiling",
      markdown: boiling,
    });
    await docs.read("doc-writable");
    await docs.writeSection({
      documentId: "doc-writable",
      heading: "Pouring",
      markdown: pouring,
    });

    const read = await docs.read("doc-writable");
    expect(read.sections.get("Boiling")).toBe(boiling);
    expect(read.sections.get("Pouring")).toBe(pouring);
    const cells = (await documents.documentOf("doc-writable")).body?.content
      .flatMap(({ table: written }) => written?.tableRows ?? [])
      .flatMap(({ tableCells }) => tableCells);
    expect(cells).toHaveLength(8);
    cells?.forEach(({ content }) => {
      expect(content).toHaveLength(1);
      expect(content[0]?.paragraph?.paragraphStyle?.namedStyleType).toBe(
        "NORMAL_TEXT",
      );
      expect(content[0]?.paragraph?.bullet).toBeUndefined();
    });
  });

  it("gives a table inserted under a heading plain cells", async () => {
    const { docs, documents } = await writableDocs();
    const markdown =
      "Kettles boil water fast.\n\nSteam rises.\n\n### Spouts\n\n| Spout | Angle |\n| --- | --- |\n| Swan | 30 |\n\nMost spouts face away.\n";

    await docs.writeSection({
      documentId: "doc-writable",
      heading: "Boiling",
      markdown,
    });

    expect((await docs.read("doc-writable")).sections.get("Boiling")).toBe(
      markdown,
    );
    const paragraphs = (
      await documents.documentOf("doc-writable")
    ).body?.content.flatMap(({ table }) =>
      (table?.tableRows ?? []).flatMap(({ tableCells }) =>
        tableCells.flatMap(({ content }) => content),
      ),
    );
    expect(
      paragraphs?.map(({ paragraph }) => paragraph?.paragraphStyle),
    ).toEqual(Array(4).fill({ namedStyleType: "NORMAL_TEXT" }));
  });

  it("styles a paragraph inserted after a heading as plain text", async () => {
    const { docs, documents } = await writableDocs();
    const markdown =
      "Kettles boil water fast.\n\nSteam rises.\n\n### Spouts\n\nSpouts pour.\n\nMost spouts face away.\n";

    await docs.writeSection({
      documentId: "doc-writable",
      heading: "Boiling",
      markdown,
    });

    expect((await docs.read("doc-writable")).sections.get("Boiling")).toBe(
      markdown,
    );
    const inserted = (
      await documents.documentOf("doc-writable")
    ).body?.content.find(
      ({ paragraph }) =>
        paragraph?.elements[0]?.textRun?.content === "Spouts pour.\n",
    );
    expect(inserted?.paragraph?.paragraphStyle).toEqual({
      namedStyleType: "NORMAL_TEXT",
    });
  });

  it("gives a paragraph inserted inside a written list no bullet", async () => {
    const { docs, documents } = await writableDocs();
    const listed =
      "Kettles boil water fast.\n\n1. Fill it\n2. Boil it\n\nSteam rises.\n\n### Spouts\n\nMost spouts face away.\n";
    await docs.writeSection({
      documentId: "doc-writable",
      heading: "Boiling",
      markdown: listed,
    });
    await docs.read("doc-writable");

    const split =
      "Kettles boil water fast.\n\n1. Fill it\n\nWait.\n\n1. Boil it\n\nSteam rises.\n\n### Spouts\n\nMost spouts face away.\n";
    await docs.writeSection({
      documentId: "doc-writable",
      heading: "Boiling",
      markdown: split,
    });

    expect((await docs.read("doc-writable")).sections.get("Boiling")).toBe(
      split,
    );
    const wait = (
      await documents.documentOf("doc-writable")
    ).body?.content.find(
      ({ paragraph }) => paragraph?.elements[0]?.textRun?.content === "Wait.\n",
    );
    expect(wait?.paragraph?.bullet).toBeUndefined();
    expect(wait?.paragraph?.paragraphStyle).toEqual({
      namedStyleType: "NORMAL_TEXT",
    });
  });

  it("adds no empty paragraph after a numbered list at the Doc's end", async () => {
    const { docs, documents } = await writableDocs();
    const markdown = "Pour slowly.\n\n1. Tilt\n2. Pour\n";

    await docs.writeSection({
      documentId: "doc-writable",
      heading: "Pouring",
      markdown,
    });

    expect((await docs.read("doc-writable")).sections.get("Pouring")).toBe(
      markdown,
    );
    const last = (await documents.documentOf("doc-writable")).body?.content.at(
      -1,
    );
    expect(last?.paragraph?.elements[0]?.textRun?.content).toBe("Pour\n");
  });

  it("edits written lists and tables on a second write", async () => {
    const { docs } = await writableDocs();
    const first =
      "Kettles boil water fast.\n\n1. Fill it\n2. Boil it\n\nSteam rises.\n\n| Kettle | Litres |\n| --- | --- |\n| Steel | 1.7 |\n\n### Spouts\n\nMost spouts face away.\n";
    await docs.writeSection({
      documentId: "doc-writable",
      heading: "Boiling",
      markdown: first,
    });
    await docs.read("doc-writable");

    const second =
      "Kettles boil water fast.\n\n1. Fill it\n2. Boil it\n3. Pour it\n- Steam rises.\n\n| Kettle | Litres |\n| --- | --- |\n| Glass | 1.5 |\n\n### Spouts\n\nMost spouts face away.\n";
    await docs.writeSection({
      documentId: "doc-writable",
      heading: "Boiling",
      markdown: second,
    });
    expect((await docs.read("doc-writable")).sections.get("Boiling")).toBe(
      second,
    );

    await docs.writeSection({
      documentId: "doc-writable",
      heading: "Boiling",
      markdown: first,
    });
    expect((await docs.read("doc-writable")).sections.get("Boiling")).toBe(
      first,
    );
  });

  it.each([
    ["a nested list", "- Fill it\n  - To the line\n"],
    ["a '+ ' item", "+ Fill it\n"],
    ["a miscounted numbered list", "1. Fill it\n3. Boil it\n"],
  ])("refuses %s", async (_, markdown) => {
    const { docs } = await writableDocs();

    await expect(
      docs.writeSection({
        documentId: "doc-writable",
        heading: "Boiling",
        markdown,
      }),
    ).rejects.toThrow();
  });

  it("reports a Doc with pending suggestions it can't index safely, writing nothing", async () => {
    const documents = new FakeDocuments([fixtureDocument("suggestions")]);
    const docs = Docs.init(documents);
    await docs.read("doc-suggestions");
    const before = await documents.documentOf("doc-suggestions");

    await expect(
      docs.writeSection({
        documentId: "doc-suggestions",
        heading: "Storage",
        markdown: "Keep it dry.\n",
      }),
    ).rejects.toThrow(new PendingSuggestions("doc-suggestions"));
    expect(await documents.documentOf("doc-suggestions")).toEqual(before);
  });

  describe("with a page break", () => {
    const pageBreakParagraph: StructuralElement = {
      paragraph: {
        elements: [{ pageBreak: {} }, { textRun: { content: "\n" } }],
        paragraphStyle: { namedStyleType: "NORMAL_TEXT" },
      },
    };

    async function docsWithPageBreakAt(position: number): Promise<{
      docs: Docs;
      documents: FakeDocuments;
    }> {
      const document = fixtureDocument("writable");
      document.body?.content.splice(position, 0, pageBreakParagraph);
      const documents = new FakeDocuments([document]);
      const docs = Docs.init(documents);
      await docs.read("doc-writable");
      return { docs, documents };
    }

    it("writes a Section past a page break outside it, keeping the break", async () => {
      const { docs, documents } = await docsWithPageBreakAt(2);
      const markdown = "Kettles whistle.\n";

      await docs.writeSection({
        documentId: "doc-writable",
        heading: "Boiling",
        markdown,
      });

      const read = await docs.read("doc-writable");
      expect(read.sections.get("Boiling")).toBe(markdown);
      expect(read.sections.get("Pouring")).toBe("Pour slowly.\n");
      const written = await documents.documentOf("doc-writable");
      expect(written.body?.content[2]?.paragraph?.elements[0]).toMatchObject({
        pageBreak: {},
      });
    });

    it("writes a Section ending in a page break before it, keeping the break before the next heading", async () => {
      const { docs, documents } = await docsWithPageBreakAt(7);
      const markdown = "Kettles whistle.\n\nSteam rises.\n\nLids rattle.\n";

      await docs.writeSection({
        documentId: "doc-writable",
        heading: "Boiling",
        markdown,
      });

      const read = await docs.read("doc-writable");
      expect(read.sections.get("Boiling")).toBe(markdown);
      expect(read.sections.get("Pouring")).toBe("Pour slowly.\n");
      const content =
        (await documents.documentOf("doc-writable")).body?.content ?? [];
      const pouring = content.findIndex(
        ({ paragraph }) =>
          paragraph?.elements[0]?.textRun?.content === "Pouring\n",
      );
      expect(content[pouring - 1]?.paragraph?.elements[0]).toMatchObject({
        pageBreak: {},
      });
      expect(
        content[pouring - 2]?.paragraph?.elements[0]?.textRun?.content,
      ).toBe("Lids rattle.\n");
    });

    it("refuses a Section holding a page break, writing nothing", async () => {
      const { docs, documents } = await docsWithPageBreakAt(4);
      const before = await documents.documentOf("doc-writable");

      await expect(
        docs.writeSection({
          documentId: "doc-writable",
          heading: "Boiling",
          markdown: "Kettles whistle.\n",
        }),
      ).rejects.toThrow(
        'The writer takes only text in the Section "Boiling", not a footnote, image or page break.',
      );
      expect(await documents.documentOf("doc-writable")).toEqual(before);
    });
  });

  it("refuses a write before any read", async () => {
    const docs = docsOf("writable");

    await expect(
      docs.writeSection({
        documentId: "doc-writable",
        heading: "Boiling",
        markdown: "Kettles whistle.\n",
      }),
    ).rejects.toThrow("Read Doc doc-writable before writing to it.");
  });
});

describe("the Docs module's imports", () => {
  const sourceFolder = new URL("./", import.meta.url);

  function importsOf(path: string): string[] {
    const source = readFileSync(new URL(path, sourceFolder), "utf8");
    return [...source.matchAll(/from "([^"]+)"/g)].flatMap((match) =>
      match[1] === undefined ? [] : [match[1]],
    );
  }

  it("reaches nothing else of the runner", () => {
    const docsFiles = readdirSync(new URL("Docs/", sourceFolder))
      .filter((name) => name.endsWith(".ts"))
      .map((name) => `Docs/${name}`);
    const outside = ["Docs.ts", "Docs.test.ts", ...docsFiles].flatMap((path) =>
      importsOf(path)
        .filter((specifier) => specifier.startsWith("."))
        .map((specifier) => new URL(specifier, new URL(path, sourceFolder)))
        .filter((url) => {
          const relative = url.pathname.slice(sourceFolder.pathname.length);
          return relative !== "Docs.ts" && !relative.startsWith("Docs/");
        })
        .map((url) => `${path} imports ${url.pathname}`),
    );

    expect(outside).toEqual([]);
  });

  it("keeps the Google Docs layer and the Markdown dialect apart", () => {
    expect(importsOf("Docs/googleDocs.ts")).toEqual([]);
    expect(importsOf("Docs/markdownDialect.ts")).toEqual(["./InlineParser.ts"]);
    expect(importsOf("Docs/InlineParser.ts")).toEqual([]);
  });
});
