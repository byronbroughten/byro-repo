import { describe, expect, it } from "vitest";

import { docPrint } from "./docPrint.ts";
import { fixtureDocument } from "./Docs/docFixtures.ts";
import { FakeDocuments } from "./Docs/FakeDocuments.ts";

const documents = new FakeDocuments([fixtureDocument("headings")]);
const headingsMarkdown =
  "# A Field Guide to Kettles\n\n## Why kettles\n\nA kettle boils water faster than a pan.\n\n### Spouts\n\nMost spouts face away.\n\n## Which kettle\n\nBuy the one with a whistle.\n";

describe("docPrint.markdownOf", () => {
  it("prints a Doc named by its ID as the dialect's Markdown", async () => {
    expect(await docPrint.markdownOf(documents, "doc-headings")).toBe(
      headingsMarkdown,
    );
  });

  it("prints a Doc named by its URL", async () => {
    expect(
      await docPrint.markdownOf(
        documents,
        "https://docs.google.com/document/d/doc-headings/edit?tab=t.0",
      ),
    ).toBe(headingsMarkdown);
  });
});
