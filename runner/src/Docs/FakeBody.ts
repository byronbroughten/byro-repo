// The body FakeDocuments edits for a `documents.batchUpdate`: one UTF-16 code
// unit per index, as Docs counts them, each with its text style, a paragraph's
// style and bullet held on the newline that ends it, as Docs does. A newline
// inserted is a new paragraph: it copies the style and bullet of the paragraph
// it lands in but not its headingId, and a heading with no headingId gets a
// fresh one; a heading split at its end keeps its headingId on its text, as
// Docs does. A paragraph taken out of a list keeps the list's indent. A table
// is a marker index, then a marker per row and per cell before the cell's
// paragraphs; its cells copy the paragraph it was inserted into, the worst Docs
// could do. It holds plain text runs, and any other paragraph element whole at
// its one index, as Docs counts a page break or image.

import { DocsRequestRefused } from "./DocsRequestRefused.ts";
import type {
  Body,
  Bullet,
  BulletPreset,
  InsertTableRequest,
  List,
  NamedStyleType,
  Paragraph,
  ParagraphElement,
  ParagraphStyle,
  Range,
  Request,
  StructuralElement,
  Table,
  TableRow,
  TextStyle,
} from "./googleDocs.ts";

type MarkerKind = "table" | "row" | "cell";

interface BodyChar {
  char: string;
  textStyle: TextStyle;
  paragraphStyle: ParagraphStyle | undefined;
  bullet: Bullet | undefined;
  marker: MarkerKind | undefined;
  /** The marker of the table this index belongs to, the table's own marker included. */
  table: BodyChar | undefined;
  /** The marker of the cell whose text this is. */
  cell: BodyChar | undefined;
  /** An element other than a text run, held whole at this index. */
  nonText: ParagraphElement | undefined;
}

/** Where a character sits: inside a table's cell, or outside every table. */
interface CharPlace {
  table: BodyChar | undefined;
  cell: BodyChar | undefined;
}

const textStyleFields = ["bold", "italic", "underline", "link"] as const;

const paragraphStyleFields = [
  "namedStyleType",
  "indentStart",
  "indentFirstLine",
] as const;

/** The indent Docs gives a new list's first level. */
const listIndent = {
  indentStart: { magnitude: 36, unit: "PT" },
  indentFirstLine: { magnitude: 18, unit: "PT" },
} as const;

const outsideTables: CharPlace = { table: undefined, cell: undefined };

export class FakeBody {
  private chars: BodyChar[];
  private readonly heldLists: Record<string, List>;
  private freshHeadingCount = 0;
  private freshListCount = 0;

  constructor(body: Body, lists: Record<string, List>) {
    this.chars = body.content.flatMap((element, position) =>
      charsOf(element, position),
    );
    this.heldLists = structuredClone(lists);
  }

  apply(request: Request): this {
    const { insertText, deleteContentRange, updateTextStyle } = request;
    const { updateParagraphStyle, createParagraphBullets } = request;
    const { deleteParagraphBullets, insertTable } = request;
    if (insertText !== undefined) {
      this._insert(insertText.text, insertText.location.index);
    } else if (deleteContentRange !== undefined) {
      this._delete(deleteContentRange.range);
    } else if (updateTextStyle !== undefined) {
      const { range, textStyle, fields } = updateTextStyle;
      this._styleText(range, textStyle, fields);
    } else if (updateParagraphStyle !== undefined) {
      const { range, paragraphStyle, fields } = updateParagraphStyle;
      this._styleParagraphs(range, paragraphStyle, fields);
    } else if (createParagraphBullets !== undefined) {
      const { range, bulletPreset } = createParagraphBullets;
      this._bullet(range, bulletPreset);
    } else if (deleteParagraphBullets !== undefined) {
      this._unbullet(deleteParagraphBullets.range);
    } else if (insertTable !== undefined) {
      this._insertTable(insertTable);
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
    while (start < this.chars.length) {
      const element = this._elementAt(start);
      content.push(element);
      start = (element.endIndex ?? start + 1) - 1;
    }
    return { content };
  }

  get lists(): Record<string, List> {
    return structuredClone(this.heldLists);
  }

  private _insert(text: string, index: number): void {
    const position = this._positionOf(index);
    const before = this.chars[position - 1];
    const after = this.chars[position];
    if (after?.marker !== undefined) {
      throw refused(`The index ${index} is not inside a paragraph.`);
    }
    const startsParagraph =
      before === undefined ||
      before.char === "\n" ||
      before.marker !== undefined;
    let textStyle = before?.textStyle ?? {};
    if (startsParagraph) {
      textStyle = after?.textStyle ?? {};
    }
    const landed = this._newlineFrom(position);
    const place = { table: after?.table, cell: after?.cell };
    const inserted = text.split("").map((char) => ({
      ...(char === "\n"
        ? newlineCopying(landed, place)
        : plainChar(char, place)),
      textStyle: { ...textStyle },
    }));
    if (after === landed && !startsParagraph) {
      keepHeadingIdOnText(landed, inserted);
    }
    this.chars.splice(position, 0, ...inserted);
  }

  private _insertTable({ rows, columns, location }: InsertTableRequest): void {
    const position = this._positionOf(location.index);
    const at = this.chars[position];
    if (at?.marker !== undefined || at?.table !== undefined) {
      throw refused(
        `A table goes inside a paragraph outside any table, not at ${location.index}.`,
      );
    }
    this._insert("\n", location.index);
    const landed = this._newlineFrom(position + 1);
    const cells = [...Array(rows).keys()].map(() =>
      [...Array(columns).keys()].map(() => (place: CharPlace): BodyChar[] => [
        {
          ...newlineCopying(landed, place),
          textStyle: { ...landed.textStyle },
        },
      ]),
    );
    this.chars.splice(position + 1, 0, ...tableCharsOf(cells));
  }

  private _delete({ startIndex, endIndex }: Range): void {
    const start = this._positionOf(startIndex);
    const end = this._positionOf(endIndex);
    if (end <= start) {
      throw refused(`The range ${startIndex}-${endIndex} is empty.`);
    }
    const removed = this.chars.slice(start, end);
    const tables = new Set(removed.flatMap((bodyChar) => bodyChar.table ?? []));
    tables.forEach((table) => {
      this._refuseCutInto(table, removed, startIndex);
    });
    if (this.chars[end]?.marker === "table") {
      throw refused(`The newline before the table at ${endIndex} can't go.`);
    }
    this.chars.splice(start, end - start);
  }

  /** Refuses a deletion that takes part of a table, unless it stays inside one cell's text and keeps the cell's last newline. */
  private _refuseCutInto(
    table: BodyChar,
    removed: BodyChar[],
    startIndex: number,
  ): void {
    const tableChars = this.chars.filter(
      (bodyChar) => bodyChar.table === table,
    );
    if (tableChars.every((bodyChar) => removed.includes(bodyChar))) {
      return;
    }
    const cell = removed[0]?.cell;
    const cellChars = this.chars.filter((bodyChar) => bodyChar.cell === cell);
    const isInOneCell =
      cell !== undefined &&
      removed.every((bodyChar) => bodyChar.cell === cell) &&
      !removed.includes(cellChars.at(-1) ?? cell);
    if (!isInOneCell) {
      throw refused(`The deletion at ${startIndex} cuts into a table.`);
    }
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

  /** Sets each named field, and resets a named field the style leaves out. */
  private _styleParagraphs(
    range: Range,
    paragraphStyle: ParagraphStyle,
    fields: string,
  ): void {
    const named = fields.split(",");
    this._newlinesIn(range).forEach((newline) => {
      const style = { ...newline.paragraphStyle };
      paragraphStyleFields
        .filter((field) => named.includes(field))
        .forEach((field) => {
          const value = paragraphStyle[field];
          if (value === undefined) {
            delete style[field];
            return;
          }
          Object.assign(style, { [field]: value });
        });
      if (!isHeading(style.namedStyleType)) {
        delete style.headingId;
      }
      newline.paragraphStyle = style;
    });
  }

  /** Takes each paragraph out of its list, keeping its list's indent as Docs does. */
  private _unbullet(range: Range): void {
    this._newlinesIn(range).forEach((newline) => {
      const { bullet } = newline;
      if (bullet === undefined) {
        return;
      }
      const nestingLevel =
        this.heldLists[bullet.listId]?.listProperties.nestingLevels[
          bullet.nestingLevel ?? 0
        ];
      const { indentStart, indentFirstLine } = nestingLevel ?? {};
      newline.paragraphStyle = {
        ...newline.paragraphStyle,
        ...(indentStart === undefined ? {} : { indentStart }),
        ...(indentFirstLine === undefined ? {} : { indentFirstLine }),
      };
      newline.bullet = undefined;
    });
  }

  /** Puts every paragraph the range touches in one new list. */
  private _bullet(range: Range, bulletPreset: BulletPreset): void {
    let listId: string;
    do {
      this.freshListCount += 1;
      listId = `list.fresh${this.freshListCount}`;
    } while (this.heldLists[listId] !== undefined);
    const glyph = bulletPreset.startsWith("NUMBERED_")
      ? { glyphType: "DECIMAL" }
      : { glyphSymbol: "●" };
    const nestingLevel = { ...glyph, ...listIndent };
    this.heldLists[listId] = {
      listProperties: { nestingLevels: [nestingLevel] },
    };
    this._newlinesIn(range).forEach((newline) => {
      newline.bullet = { listId };
    });
  }

  /** The newline ending each paragraph the range touches. */
  private _newlinesIn(range: Range): BodyChar[] {
    const first = this._newlineFrom(this._positionOf(range.startIndex));
    const last = this._newlineFrom(this._positionOf(range.endIndex - 1));
    return this.chars
      .slice(this.chars.indexOf(first), this.chars.indexOf(last) + 1)
      .filter((bodyChar) => bodyChar.char === "\n");
  }

  private _elementAt(start: number): StructuralElement {
    if (this.chars[start]?.marker === "table") {
      return this._tableAt(start);
    }
    const end = this.chars.indexOf(this._newlineFrom(start)) + 1;
    return this._paragraphOf(start, end);
  }

  private _tableAt(start: number): StructuralElement {
    const tableMarker = this.chars[start];
    let end = start + 1;
    while (end < this.chars.length && this.chars[end]?.table === tableMarker) {
      end += 1;
    }
    const tableRows: TableRow[] = [];
    let cellContent: StructuralElement[] = [];
    let paragraphStart = start + 1;
    this.chars.slice(start + 1, end).forEach((bodyChar, offset) => {
      const position = start + 1 + offset;
      if (bodyChar.marker === "row") {
        tableRows.push({ tableCells: [] });
      } else if (bodyChar.marker === "cell") {
        cellContent = [];
        tableRows.at(-1)?.tableCells.push({ content: cellContent });
        paragraphStart = position + 1;
      } else if (bodyChar.char === "\n") {
        cellContent.push(this._paragraphOf(paragraphStart, position + 1));
        paragraphStart = position + 1;
      }
    });
    const table: Table = {
      rows: tableRows.length,
      columns: tableRows[0]?.tableCells.length ?? 0,
      tableRows,
    };
    return { startIndex: start + 1, endIndex: end + 1, table };
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
    const paragraph: Paragraph = {
      elements: elementsOf(chars, start + 1),
      paragraphStyle,
    };
    if (newline?.bullet !== undefined) {
      paragraph.bullet = { ...newline.bullet };
    }
    return { startIndex: start + 1, endIndex: end + 1, paragraph };
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
  if (element.table !== undefined) {
    return tableChars(element.table);
  }
  if (element.paragraph === undefined) {
    throw new Error("The fake body holds only paragraphs and tables.");
  }
  return paragraphChars(element.paragraph, outsideTables);
}

function tableChars(table: Table): BodyChar[] {
  const cells = table.tableRows.map((row) =>
    row.tableCells.map(
      (cell) =>
        (place: CharPlace): BodyChar[] =>
          cell.content.flatMap(({ paragraph }) => {
            if (paragraph === undefined) {
              throw new Error("A fake table's cells hold only paragraphs.");
            }
            return paragraphChars(paragraph, place);
          }),
    ),
  );
  return tableCharsOf(cells);
}

/** A table's marker, then per row a marker and per cell a marker and the characters its function gives for that cell. */
function tableCharsOf(
  cells: ((place: CharPlace) => BodyChar[])[][],
): BodyChar[] {
  const tableMarker = markerChar("table", undefined);
  tableMarker.table = tableMarker;
  const rows = cells.flatMap((row) => [
    markerChar("row", tableMarker),
    ...row.flatMap((cellChars) => {
      const cellMarker = markerChar("cell", tableMarker);
      return [
        cellMarker,
        ...cellChars({ table: tableMarker, cell: cellMarker }),
      ];
    }),
  ]);
  return [tableMarker, ...rows];
}

function paragraphChars(paragraph: Paragraph, place: CharPlace): BodyChar[] {
  return paragraph.elements.flatMap((element) => {
    const { textRun } = element;
    if (textRun === undefined) {
      const { startIndex: _start, endIndex: _end, ...nonText } = element;
      return [{ ...plainChar("", place), nonText: structuredClone(nonText) }];
    }
    if ((textRun.suggestedInsertionIds?.length ?? 0) > 0) {
      throw new Error("The fake body holds no suggested text.");
    }
    return textRun.content.split("").map((char) => {
      const bodyChar = {
        ...plainChar(char, place),
        textStyle: { ...textRun.textStyle },
      };
      if (char === "\n") {
        bodyChar.paragraphStyle = { ...paragraph.paragraphStyle };
        bodyChar.bullet =
          paragraph.bullet === undefined ? undefined : { ...paragraph.bullet };
      }
      return bodyChar;
    });
  });
}

function plainChar(char: string, { table, cell }: CharPlace): BodyChar {
  return {
    char,
    textStyle: {},
    paragraphStyle: undefined,
    bullet: undefined,
    marker: undefined,
    table,
    cell,
    nonText: undefined,
  };
}

function markerChar(marker: MarkerKind, table: BodyChar | undefined): BodyChar {
  return { ...plainChar("", { table, cell: undefined }), marker };
}

/** A new paragraph's newline, styled as the paragraph it lands in, its headingId aside. */
function newlineCopying(landed: BodyChar, place: CharPlace): BodyChar {
  const { headingId: _, ...paragraphStyle } = landed.paragraphStyle ?? {};
  return {
    ...plainChar("\n", place),
    paragraphStyle,
    bullet: landed.bullet === undefined ? undefined : { ...landed.bullet },
  };
}

/** Moves a heading's headingId from the newline it was split at to the first inserted newline. */
function keepHeadingIdOnText(landed: BodyChar, inserted: BodyChar[]): void {
  const { headingId, ...landedStyle } = landed.paragraphStyle ?? {};
  const textEnd = inserted.find((bodyChar) => bodyChar.char === "\n");
  if (headingId === undefined || textEnd === undefined) {
    return;
  }
  textEnd.paragraphStyle = { ...textEnd.paragraphStyle, headingId };
  landed.paragraphStyle = landedStyle;
}

function elementsOf(chars: BodyChar[], startIndex: number): ParagraphElement[] {
  return chars.reduce<ParagraphElement[]>((elements, bodyChar, offset) => {
    const last = elements.at(-1);
    const { textStyle, nonText } = bodyChar;
    if (nonText !== undefined) {
      elements.push({
        ...structuredClone(nonText),
        startIndex: startIndex + offset,
        endIndex: startIndex + offset + 1,
      });
      return elements;
    }
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
