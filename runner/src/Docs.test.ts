import { readdirSync, readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import { Docs } from "./Docs.ts";
import { fixtureDocument } from "./Docs/docFixtures.ts";
import { FakeDocuments } from "./Docs/FakeDocuments.ts";

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
