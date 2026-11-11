import { describe, expect, it } from "vitest";

import { FakeBody } from "./FakeBody.ts";
import type { StructuralElement } from "./googleDocs.ts";

function headingOf(
  text: string,
  headingId: string,
  startIndex: number,
): StructuralElement {
  const endIndex = startIndex + text.length + 1;
  return {
    startIndex,
    endIndex,
    paragraph: {
      elements: [{ startIndex, endIndex, textRun: { content: `${text}\n` } }],
      paragraphStyle: { namedStyleType: "HEADING_2", headingId },
    },
  };
}

// Alpha at 1-7, then Gamma, the body's last paragraph, at 7-13.
function twoHeadings(): FakeBody {
  return new FakeBody(
    {
      content: [
        { startIndex: 0, endIndex: 1, sectionBreak: {} },
        headingOf("Alpha", "h.alpha", 1),
        headingOf("Gamma", "h.gamma", 7),
      ],
    },
    {},
  );
}

function headingsOf(body: FakeBody): [string, string | undefined][] {
  return body.body.content.flatMap(({ paragraph }) => {
    if (paragraph === undefined) return [];
    const text = paragraph.elements
      .map((element) => element.textRun?.content ?? "")
      .join("");
    return [[text, paragraph.paragraphStyle?.headingId]];
  });
}

describe("a split heading's headingId", () => {
  it("stays on the heading's text when a newline splits it at its end", () => {
    const body = twoHeadings().apply({
      insertText: { text: "\nX", location: { index: 12 } },
    });

    expect(headingsOf(body)).toEqual([
      ["Alpha\n", "h.alpha"],
      ["Gamma\n", "h.gamma"],
      ["X\n", expect.stringMatching(/^h\.fresh/)],
    ]);
  });

  it("stays on the heading's text when a newline splits it at its start", () => {
    const body = twoHeadings().apply({
      insertText: { text: "Y\n", location: { index: 7 } },
    });

    expect(headingsOf(body)).toEqual([
      ["Alpha\n", "h.alpha"],
      ["Y\n", expect.stringMatching(/^h\.fresh/)],
      ["Gamma\n", "h.gamma"],
    ]);
  });
});
