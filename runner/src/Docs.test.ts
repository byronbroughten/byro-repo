import { readdirSync, readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import { Docs } from "./Docs.ts";
import { fixtureDocument } from "./Docs/docFixtures.ts";
import { FakeDocuments } from "./Docs/FakeDocuments.ts";
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
    expect(importsOf("Docs/markdownDialect.ts")).toEqual([]);
  });
});
