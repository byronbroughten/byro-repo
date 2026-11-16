import { describe, expect, it } from "vitest";

import { FakeDocuments } from "./FakeDocuments.ts";
import type { GoogleDocument } from "./googleDocs.ts";

function documentWithHeading(): GoogleDocument {
  return {
    documentId: "doc-heading",
    revisionId: "rev-1",
    body: {
      content: [
        { sectionBreak: {} },
        {
          paragraph: {
            elements: [{ textRun: { content: "Kinds\n" } }],
            paragraphStyle: {
              namedStyleType: "HEADING_2",
              headingId: "h.kinds",
            },
          },
        },
      ],
    },
  };
}

async function headingOf(
  documents: FakeDocuments,
): Promise<{ text: string; style: object | undefined; revisionId: string }> {
  const document = await documents.documentOf("doc-heading");
  const paragraph = document.body?.content[1]?.paragraph;
  return {
    text:
      paragraph?.elements.map(({ textRun }) => textRun?.content).join("") ?? "",
    style: paragraph?.paragraphStyle,
    revisionId: document.revisionId,
  };
}

describe("FakeDocuments.editHeading", () => {
  it("keeps a heading's ID when its text is retyped in the editor, as the probe recorded", async () => {
    const documents = new FakeDocuments([documentWithHeading()]);

    documents.editHeading("doc-heading", "h.kinds", { text: "Types" });

    const heading = await headingOf(documents);
    expect(heading.text).toBe("Types\n");
    expect(heading.style).toEqual({
      namedStyleType: "HEADING_2",
      headingId: "h.kinds",
    });
    expect(heading.revisionId).not.toBe("rev-1");
  });

  it("keeps a heading's ID when its level is changed in the editor, as the probe recorded", async () => {
    const documents = new FakeDocuments([documentWithHeading()]);

    documents.editHeading("doc-heading", "h.kinds", {
      namedStyleType: "HEADING_1",
    });

    const heading = await headingOf(documents);
    expect(heading.text).toBe("Kinds\n");
    expect(heading.style).toEqual({
      namedStyleType: "HEADING_1",
      headingId: "h.kinds",
    });
  });

  it("refuses a heading ID the Doc doesn't hold", () => {
    const documents = new FakeDocuments([documentWithHeading()]);

    expect(() =>
      documents.editHeading("doc-heading", "h.gone", { text: "Types" }),
    ).toThrow("No heading h.gone in Doc doc-heading.");
  });
});
