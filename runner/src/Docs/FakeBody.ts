// The body FakeDocuments edits for a `documents.batchUpdate`: one character per
// index, each with its text style, a paragraph's style held on the newline that
// ends it, as Docs does. A newline inserted is a new paragraph: it copies the
// style of the paragraph it lands in but not its headingId, and a heading with
// no headingId gets a fresh one. It holds paragraphs of plain text runs only.

import { DocsRequestRefused } from "./DocsRequestRefused.ts";
import type {
  Body,
  NamedStyleType,
  ParagraphElement,
  ParagraphStyle,
  Range,
  Request,
  StructuralElement,
  TextStyle,
} from "./googleDocs.ts";

interface BodyChar {
  char: string;
  textStyle: TextStyle;
  paragraphStyle: ParagraphStyle | undefined;
}

const textStyleFields = ["bold", "italic", "underline", "link"] as const;

export class FakeBody {
  private chars: BodyChar[];
  private freshHeadingCount = 0;

  constructor(body: Body) {
    this.chars = body.content.flatMap((element, position) =>
      charsOf(element, position),
    );
  }

  apply(request: Request): this {
    const { insertText, deleteContentRange, updateTextStyle } = request;
    const { updateParagraphStyle } = request;
    if (insertText !== undefined) {
      this._insert(insertText.text, insertText.location.index);
    } else if (deleteContentRange !== undefined) {
      this._delete(deleteContentRange.range);
    } else if (updateTextStyle !== undefined) {
      const { range, textStyle, fields } = updateTextStyle;
      this._styleText(range, textStyle, fields);
    } else if (updateParagraphStyle !== undefined) {
      const { range, paragraphStyle } = updateParagraphStyle;
      this._styleParagraphs(range, paragraphStyle.namedStyleType);
    } else {
      throw refused(`The fake applies no request ${JSON.stringify(request)}.`);
    }
    return this;
  }

  get body(): Body {
    const content: StructuralElement[] = [
      { startIndex: 0, endIndex: 1, sectionBreak: {} },
    ];
    let start = 0;
    this.chars.forEach((bodyChar, position) => {
      if (bodyChar.char !== "\n") {
        return;
      }
      content.push(this._paragraphOf(start, position + 1));
      start = position + 1;
    });
    return { content };
  }

  private _insert(text: string, index: number): void {
    const position = this._positionOf(index);
    const before = this.chars[position - 1];
    const after = this.chars[position];
    const textStyle =
      before === undefined || before.char === "\n"
        ? (after?.textStyle ?? {})
        : before.textStyle;
    const { headingId: _, ...paragraphStyle } =
      this._newlineFrom(position).paragraphStyle ?? {};
    const inserted = [...text].map((char) => ({
      char,
      textStyle: { ...textStyle },
      paragraphStyle: char === "\n" ? { ...paragraphStyle } : undefined,
    }));
    this.chars.splice(position, 0, ...inserted);
  }

  private _delete({ startIndex, endIndex }: Range): void {
    const start = this._positionOf(startIndex);
    const end = this._positionOf(endIndex);
    if (end <= start) {
      throw refused(`The range ${startIndex}-${endIndex} is empty.`);
    }
    this.chars.splice(start, end - start);
  }

  private _styleText(range: Range, textStyle: TextStyle, fields: string): void {
    const named = fields.split(",");
    this._charsIn(range).forEach((bodyChar) => {
      textStyleFields
        .filter((field) => named.includes(field))
        .forEach((field) => {
          const value = textStyle[field];
          if (value === undefined || value === false) {
            delete bodyChar.textStyle[field];
            return;
          }
          Object.assign(bodyChar.textStyle, { [field]: value });
        });
    });
  }

  private _styleParagraphs(
    range: Range,
    namedStyleType: NamedStyleType | undefined,
  ): void {
    const first = this._newlineFrom(this._positionOf(range.startIndex));
    const last = this._newlineFrom(this._positionOf(range.endIndex - 1));
    const firstPosition = this.chars.indexOf(first);
    this.chars
      .slice(firstPosition, this.chars.indexOf(last) + 1)
      .filter((bodyChar) => bodyChar.char === "\n")
      .forEach((newline) => {
        const style = { ...newline.paragraphStyle, namedStyleType };
        if (!isHeading(namedStyleType)) {
          delete style.headingId;
        }
        newline.paragraphStyle = style;
      });
  }

  private _paragraphOf(start: number, end: number): StructuralElement {
    const chars = this.chars.slice(start, end);
    const newline = chars.at(-1);
    const paragraphStyle = { ...newline?.paragraphStyle };
    if (
      isHeading(paragraphStyle.namedStyleType) &&
      paragraphStyle.headingId === undefined
    ) {
      paragraphStyle.headingId = this._freshHeadingId();
      if (newline !== undefined) {
        newline.paragraphStyle = paragraphStyle;
      }
    }
    return {
      startIndex: start + 1,
      endIndex: end + 1,
      paragraph: { elements: elementsOf(chars, start + 1), paragraphStyle },
    };
  }

  private _freshHeadingId(): string {
    const taken = new Set(
      this.chars.map((bodyChar) => bodyChar.paragraphStyle?.headingId),
    );
    let headingId: string;
    do {
      this.freshHeadingCount += 1;
      headingId = `h.fresh${this.freshHeadingCount}`;
    } while (taken.has(headingId));
    return headingId;
  }

  private _charsIn({ startIndex, endIndex }: Range): BodyChar[] {
    return this.chars.slice(
      this._positionOf(startIndex),
      this._positionOf(endIndex, this.chars.length),
    );
  }

  /** The position in `chars` of a body index, refused outside the body. */
  private _positionOf(index: number, last = this.chars.length - 1): number {
    const position = index - 1;
    if (!Number.isInteger(index) || position < 0 || position > last) {
      throw refused(`The index ${index} is outside the body.`);
    }
    return position;
  }

  private _newlineFrom(position: number): BodyChar {
    const newline = this.chars
      .slice(position)
      .find((bodyChar) => bodyChar.char === "\n");
    if (newline === undefined) {
      throw new Error("A fake body ends in a newline.");
    }
    return newline;
  }
}

function charsOf(element: StructuralElement, position: number): BodyChar[] {
  if (element.sectionBreak !== undefined && position === 0) {
    return [];
  }
  const { paragraph } = element;
  if (paragraph === undefined || paragraph.bullet !== undefined) {
    throw new Error("The fake body holds only paragraphs.");
  }
  return paragraph.elements.flatMap(({ textRun }) => {
    if (
      textRun === undefined ||
      (textRun.suggestedInsertionIds?.length ?? 0) > 0
    ) {
      throw new Error("The fake body holds only plain text runs.");
    }
    return [...textRun.content].map((char) => ({
      char,
      textStyle: { ...textRun.textStyle },
      paragraphStyle:
        char === "\n" ? { ...paragraph.paragraphStyle } : undefined,
    }));
  });
}

function elementsOf(chars: BodyChar[], startIndex: number): ParagraphElement[] {
  return chars.reduce<ParagraphElement[]>((elements, bodyChar, offset) => {
    const last = elements.at(-1);
    const textStyle = bodyChar.textStyle;
    if (
      last?.textRun !== undefined &&
      styleKeyOf(last.textRun.textStyle) === styleKeyOf(textStyle)
    ) {
      last.textRun.content += bodyChar.char;
      last.endIndex = startIndex + offset + 1;
      return elements;
    }
    elements.push({
      startIndex: startIndex + offset,
      endIndex: startIndex + offset + 1,
      textRun:
        Object.keys(textStyle).length === 0
          ? { content: bodyChar.char }
          : { content: bodyChar.char, textStyle: { ...textStyle } },
    });
    return elements;
  }, []);
}

function styleKeyOf(textStyle: TextStyle = {}): string {
  return JSON.stringify(textStyleFields.map((field) => textStyle[field]));
}

function isHeading(namedStyleType: NamedStyleType | undefined): boolean {
  return namedStyleType?.startsWith("HEADING_") === true;
}

function refused(message: string): DocsRequestRefused {
  return new DocsRequestRefused(400, message);
}
