// Turns a Section's new Markdown into the `batchUpdate` requests that rewrite it
// in place in the document it was read from: blocks are diffed by
// `sectionDiff.ts`, only the changed paragraphs are touched, and inside each
// only the smallest differing range, so comments on unchanged text keep their
// anchors and unchanged headings their headingIds; a hunk holding a table is
// rewritten whole. Text requests run from the end of the body back, so each
// one's indices are the read document's; `SectionWriter/BulletPlacer.ts` adds
// the bullets last. Every paragraph inserted gets its style and bullets set, so
// it takes none from a neighbour. The Markdown is parsed by `markdownDialect.ts`,
// and `Docs.ts` sends the requests under the revision guard.

import {
  headingLevels,
  headingStyleTypes,
  headingTextsOf,
  listKindOf,
} from "./DocReader.ts";
import type {
  GoogleDocument,
  Link,
  List,
  Paragraph,
  Range,
  Request,
  StructuralElement,
  Table,
} from "./googleDocs.ts";
import {
  markdownDialect,
  type ParsedBlock,
  type SpanStyle,
} from "./markdownDialect.ts";
import { PendingSuggestions } from "./PendingSuggestions.ts";
import {
  type HeldBlock,
  type HeldParagraph,
  type Hunk,
  sectionDiff,
  type StyledChar,
  unitLengthOf,
  type WrittenBlock,
  type WrittenParagraph,
  type WrittenTable,
} from "./sectionDiff.ts";
import {
  BulletPlacer,
  type LaidParagraph,
  paragraphRangeOf,
  type PlacedParagraph,
} from "./SectionWriter/BulletPlacer.ts";

/** What a character of the written text needs: nothing, a new style, or every style, since it is new text. */
type CharChange = "unchanged" | "restyled" | "inserted";

interface RestyledChar extends StyledChar {
  change: CharChange;
}

/** A run of changed characters sharing a style and a change, by its UTF-16 offsets in the paragraph. */
interface StyleRun {
  start: number;
  end: number;
  style: SpanStyle;
  change: CharChange;
}

/** Requests, how much they lengthen the body, and the paragraphs they write, placed as if they ran alone. */
interface BodyChange {
  requests: Request[];
  lengthChange: number;
  placed: PlacedParagraph[];
}

/** A block to insert, where it starts once inserted, and the newline it brings before or after it. */
interface LaidBlock {
  block: WrittenBlock;
  startIndex: number;
  leading: string;
  trailing: string;
}

/** A new paragraph's newline, styled with its text so it takes no style from a neighbour. */
const plainNewline: StyledChar = {
  char: "\n",
  style: { isBold: false, isItalic: false, target: undefined },
};

const emptyParagraph: WrittenParagraph = {
  kind: "paragraph",
  level: undefined,
  list: undefined,
  chars: [],
};

/** The paragraph style fields a request sets: a level alone, or everything a new paragraph could inherit. */
const paragraphStyleFields = {
  level: "namedStyleType",
  outright: "namedStyleType,indentStart,indentFirstLine",
} as const;

export class SectionWriter {
  private readonly document: GoogleDocument;
  private readonly content: StructuralElement[];
  private readonly lists: Record<string, List>;
  private readonly headingTexts: Map<string, string>;
  private readonly bodyEndIndex: number;
  private readonly tableStartIndices: Set<number>;

  constructor(document: GoogleDocument) {
    const body = document.body ?? { content: [] };
    this.document = document;
    this.content = body.content;
    this.lists = document.lists ?? {};
    this.headingTexts = headingTextsOf(body);
    this.bodyEndIndex = this.content.at(-1)?.endIndex ?? 1;
    this.tableStartIndices = new Set(
      this.content.flatMap(({ table, startIndex }) =>
        table === undefined || startIndex === undefined ? [] : [startIndex],
      ),
    );
  }

  static init(document: GoogleDocument): SectionWriter {
    return new SectionWriter(document);
  }

  private get bulletPlacer(): BulletPlacer {
    return BulletPlacer.init(this.document);
  }

  /** The requests that make the Section under `heading` read as `markdown`: text last index first, then bullets. */
  requestsFor(heading: string, markdown: string): Request[] {
    const { sectionHeading, held } = this._sectionOf(heading);
    const wanted = markdownDialect.blocksOf(markdown).flatMap(writtenOf);
    const section = sectionDiff
      .hunksOf(sectionHeading, held, wanted)
      .reduce<BodyChange>(
        (written, hunk) => {
          const change = this._hunkChange(hunk);
          const shift = written.lengthChange;
          written.requests.unshift(...change.requests);
          written.placed.push(
            ...change.placed.map((paragraph) => ({
              ...paragraph,
              startIndex: paragraph.startIndex + shift,
            })),
          );
          written.lengthChange += change.lengthChange;
          const { kept } = hunk;
          if (
            kept?.held.kind === "paragraph" &&
            kept.wanted.kind === "paragraph"
          ) {
            written.placed.push({
              paragraph: kept.wanted,
              startIndex: kept.held.startIndex + written.lengthChange,
              heldParagraph: kept.held,
            });
          }
          return written;
        },
        { requests: [], lengthChange: 0, placed: [] },
      );
    return [
      ...section.requests,
      ...this.bulletPlacer.requestsFor(section.placed),
    ];
  }

  private _sectionOf(heading: string): {
    sectionHeading: HeldParagraph;
    held: HeldBlock[];
  } {
    const written = this.content
      .flatMap((element) => this._heldBlocksOf(element))
      .filter((block) => block.kind === "table" || block.chars.length > 0);
    const start = written.findIndex(
      (block) =>
        block.kind === "paragraph" &&
        block.level === markdownDialect.syntax.sectionLevel &&
        inlineOf(block) === heading,
    );
    const sectionHeading = written[start];
    if (sectionHeading?.kind !== "paragraph") {
      throw new Error(`No Section "${heading}".`);
    }
    const after = written.slice(start + 1);
    const end = after.findIndex(
      (block) =>
        block.kind === "paragraph" &&
        block.level !== undefined &&
        block.level <= markdownDialect.syntax.sectionLevel,
    );
    const held = end === -1 ? after : after.slice(0, end);
    if (
      held.some(
        (block) =>
          block.kind === "paragraph" && (block.bullet?.nestingLevel ?? 0) > 0,
      )
    ) {
      throw new Error("The writer takes only flat lists, not a nested one.");
    }
    return { sectionHeading, held };
  }

  private _heldBlocksOf(element: StructuralElement): HeldBlock[] {
    const { paragraph, table } = element;
    if (table !== undefined) {
      return [
        { kind: "table", rows: this._rowsOf(table), ...indicesOf(element) },
      ];
    }
    if (paragraph === undefined) {
      return [];
    }
    const { bullet } = paragraph;
    const styleType = paragraph.paragraphStyle?.namedStyleType;
    return [
      {
        kind: "paragraph",
        level: styleType === undefined ? undefined : headingLevels[styleType],
        list:
          bullet === undefined
            ? undefined
            : { listKind: listKindOf(this.lists, bullet) },
        chars: this._charsOf(paragraph),
        bullet,
        ...indicesOf(element),
      },
    ];
  }

  /** Each cell's text, its paragraphs joined by line breaks as the reader joins them. */
  private _rowsOf(table: Table): StyledChar[][][] {
    if (hasPendingSuggestion(table)) {
      throw new PendingSuggestions(this.document.documentId);
    }
    return table.tableRows.map((row) =>
      row.tableCells.map((cell) =>
        cell.content
          .flatMap(({ paragraph }) =>
            paragraph === undefined ? [] : [this._charsOf(paragraph)],
          )
          .filter((chars) => chars.length > 0)
          .reduce<StyledChar[]>((joined, chars) => {
            if (joined.length > 0) {
              joined.push({ char: "\v", style: plainNewline.style });
            }
            joined.push(...chars);
            return joined;
          }, []),
      ),
    );
  }

  private _charsOf(paragraph: Paragraph): StyledChar[] {
    return paragraph.elements.flatMap(({ textRun }) => {
      if (textRun === undefined) {
        throw new Error(
          "The writer takes only plain text runs, with no footnote.",
        );
      }
      if (hasPendingSuggestion(textRun)) {
        throw new PendingSuggestions(this.document.documentId);
      }
      const style = {
        isBold: textRun.textStyle?.bold === true,
        isItalic: textRun.textStyle?.italic === true,
        target: this._targetOf(textRun.textStyle?.link),
      };
      return [...textRun.content.replace(/\n$/, "")].map((char) => ({
        char,
        style,
      }));
    });
  }

  private _targetOf(link: Link | undefined): string | undefined {
    if (link?.url !== undefined) {
      return link.url;
    }
    const headingId = link?.heading?.id ?? link?.headingId;
    const headingText =
      headingId === undefined ? undefined : this.headingTexts.get(headingId);
    return headingText === undefined
      ? undefined
      : markdownDialect.headingTarget(headingText);
  }

  /** Inserts at the hunk's end, then deletes and edits back to front; a hunk with a table pairs nothing, so it is rewritten whole. */
  private _hunkChange({ held, wanted, afterIndex }: Hunk): BodyChange {
    const hasTable = [...held, ...wanted].some(
      (block) => block.kind === "table",
    );
    const pairs = hasTable ? [] : pairsOf(held, wanted);
    const pairedChanges = pairs.map(
      ({ heldParagraph, wantedParagraph }) =>
        unitLengthOf(wantedParagraph.chars) - unitLengthOf(heldParagraph.chars),
    );
    const pairedChange = sumOf(pairedChanges);
    const edited = pairs.map(
      ({ heldParagraph, wantedParagraph }, position) => ({
        paragraph: wantedParagraph,
        startIndex:
          heldParagraph.startIndex + sumOf(pairedChanges.slice(0, position)),
        heldParagraph:
          heldParagraph.list?.listKind === wantedParagraph.list?.listKind
            ? heldParagraph
            : undefined,
      }),
    );
    const deleted = held.slice(pairs.length);
    const deletedTableStarts = new Set(
      deleted.flatMap((block) =>
        block.kind === "table" ? [block.startIndex] : [],
      ),
    );
    const deletions = deleted
      .reverse()
      .map((block) => this._deletion(block, deletedTableStarts));
    const deletedLength = -sumOf(
      deletions.map((change) => change.lengthChange),
    );
    const insertion = this._insertion(
      wanted.slice(pairs.length),
      held.at(-1)?.endIndex ?? afterIndex,
    );
    const edits = pairs
      .reverse()
      .flatMap(({ heldParagraph, wantedParagraph }) =>
        this._editRequests(heldParagraph, {
          paragraph: wantedParagraph,
          startIndex: heldParagraph.startIndex,
        }),
      );
    return {
      requests: [
        ...insertion.requests,
        ...deletions.flatMap(({ requests }) => requests),
        ...edits,
      ],
      lengthChange: pairedChange + insertion.lengthChange - deletedLength,
      placed: [
        ...edited,
        ...insertion.placed.map((paragraph) => ({
          ...paragraph,
          startIndex: paragraph.startIndex + pairedChange - deletedLength,
        })),
      ],
    };
  }

  /** Inserts before the block at `index`, or, at the body's end or a table's start, before the newline ending there. */
  private _insertion(blocks: WrittenBlock[], index: number): BodyChange {
    const isBeforeNewline =
      index === this.bodyEndIndex || this.tableStartIndices.has(index);
    const at = isBeforeNewline ? index - 1 : index;
    const laid = laidOut(blocks, at, isBeforeNewline);
    const requests = [...laid].reverse().flatMap((laidBlock, position) => {
      const isFirst = position === laid.length - 1;
      return this._laidRequests(laidBlock, at, {
        isAfterTable: laid[laid.length - 2 - position]?.block.kind === "table",
        isFirst,
        isLast: position === 0,
        isBeforeNewline,
      });
    });
    const last = laid.at(-1);
    const lengthChange =
      last === undefined
        ? 0
        : last.startIndex +
          laidLengthOf(last.block) +
          last.trailing.length -
          at;
    const placed = laid.flatMap(({ block, startIndex }) =>
      block.kind === "paragraph"
        ? [{ paragraph: block, startIndex, heldParagraph: undefined }]
        : [],
    );
    return { requests, lengthChange, placed };
  }

  /** One block's requests at `at`, the blocks after it already in. */
  private _laidRequests(
    { block, leading, trailing }: LaidBlock,
    at: number,
    neighbours: {
      isAfterTable: boolean;
      isFirst: boolean;
      isLast: boolean;
      isBeforeNewline: boolean;
    },
  ): Request[] {
    if (block.kind === "paragraph") {
      const text = block.chars.map(({ char }) => char).join("");
      return [
        {
          insertText: {
            text: `${leading}${text}${trailing}`,
            location: { index: at },
          },
        },
        ...this._newParagraphRequests({
          paragraph: block,
          startIndex: at + leading.length,
        }),
      ];
    }
    const requests: Request[] = [
      {
        insertTable: {
          rows: block.rows.length,
          columns: block.rows[0]?.length ?? 0,
          location: { index: at },
        },
      },
    ];
    const { isAfterTable, isFirst, isLast, isBeforeNewline } = neighbours;
    if (isAfterTable || (isFirst && !isBeforeNewline)) {
      requests.push(
        ...paragraphRequests({ paragraph: emptyParagraph, startIndex: at }),
      );
    }
    if (isLast && isBeforeNewline) {
      requests.push(
        ...paragraphRequests({
          paragraph: emptyParagraph,
          startIndex: at + 1 + bareTableLengthOf(block),
        }),
      );
    }
    return [...requests, ...this._cellRequests(block, at + 1)];
  }

  /** Fills each cell, the last first, with text and no newline, so no cell ends in an empty paragraph. */
  private _cellRequests(table: WrittenTable, tableStart: number): Request[] {
    const columns = table.rows[0]?.length ?? 0;
    return table.rows
      .flatMap((row, rowPosition) =>
        row.map((chars, columnPosition) => ({
          paragraph: { ...emptyParagraph, chars },
          startIndex:
            tableStart + cellOffsetOf(columns, rowPosition, columnPosition),
        })),
      )
      .reverse()
      .flatMap((cell) => {
        const text = cell.paragraph.chars.map(({ char }) => char).join("");
        return [
          ...(text === ""
            ? []
            : [
                {
                  insertText: { text, location: { index: cell.startIndex } },
                },
              ]),
          ...this._newParagraphRequests(cell),
        ];
      });
  }

  /** A new paragraph's text styles, then its paragraph style and no bullet, whatever it landed in. */
  private _newParagraphRequests(laid: LaidParagraph): Request[] {
    const inserted = [...laid.paragraph.chars, plainNewline].map((char) => ({
      ...char,
      change: "inserted" as const,
    }));
    return [
      ...this._textStyleRequests(laid.startIndex, inserted),
      ...paragraphRequests(laid),
    ];
  }

  /** Deletes a block; a paragraph before the body's end or a table it isn't deleted with keeps its newline, as Docs requires. */
  private _deletion(
    block: HeldBlock,
    deletedTableStarts: Set<number>,
  ): BodyChange {
    const { startIndex, endIndex } = block;
    const isNewlineKept =
      block.kind === "paragraph" &&
      (endIndex === this.bodyEndIndex ||
        (this.tableStartIndices.has(endIndex) &&
          !deletedTableStarts.has(endIndex)));
    if (!isNewlineKept) {
      return {
        requests: [{ deleteContentRange: { range: { startIndex, endIndex } } }],
        lengthChange: startIndex - endIndex,
        placed: [],
      };
    }
    return {
      requests: [
        {
          deleteContentRange: {
            range: { startIndex, endIndex: endIndex - 1 },
          },
        },
        ...paragraphRequests({ paragraph: emptyParagraph, startIndex }),
      ],
      lengthChange: startIndex - (endIndex - 1),
      placed: [],
    };
  }

  /** Rewrites only the range between the text the two share at each end, then restyles what differs. */
  private _editRequests(held: HeldParagraph, wanted: LaidParagraph): Request[] {
    const { startIndex } = held;
    const { chars } = wanted.paragraph;
    const prefix = sharedLength(held.chars, chars);
    const suffix = sharedLength(
      held.chars.slice(prefix).reverse(),
      chars.slice(prefix).reverse(),
    );
    const heldEnd = held.chars.length - suffix;
    const wantedEnd = chars.length - suffix;
    const editIndex = startIndex + unitLengthOf(held.chars.slice(0, prefix));
    const requests: Request[] = [];
    if (heldEnd > prefix) {
      const endIndex =
        editIndex + unitLengthOf(held.chars.slice(prefix, heldEnd));
      requests.push({
        deleteContentRange: { range: { startIndex: editIndex, endIndex } },
      });
    }
    if (wantedEnd > prefix) {
      const text = chars
        .slice(prefix, wantedEnd)
        .map(({ char }) => char)
        .join("");
      requests.push({ insertText: { text, location: { index: editIndex } } });
    }
    const shift = held.chars.length - chars.length;
    const restyled = chars.map((char, position) => {
      let kept: StyledChar | undefined;
      if (position < prefix) {
        kept = held.chars[position];
      } else if (position >= wantedEnd) {
        kept = held.chars[position + shift];
      }
      return { ...char, change: changeOf(char, kept) };
    });
    requests.push(...this._textStyleRequests(startIndex, restyled));
    if (
      held.bullet !== undefined &&
      held.list?.listKind !== wanted.paragraph.list?.listKind
    ) {
      requests.push(...paragraphRequests(wanted));
    } else if (held.level !== wanted.paragraph.level) {
      requests.push(paragraphStyleRequest(wanted, paragraphStyleFields.level));
    }
    return requests;
  }

  /** One style request per run; new text also loses any underline it took from its neighbours. */
  private _textStyleRequests(
    startIndex: number,
    chars: RestyledChar[],
  ): Request[] {
    return styleRunsOf(chars).map(({ start, end, style, change }) => {
      const link = this._linkOf(style.target);
      const isInserted = change === "inserted";
      return {
        updateTextStyle: {
          range: { startIndex: startIndex + start, endIndex: startIndex + end },
          textStyle: {
            bold: style.isBold,
            italic: style.isItalic,
            ...(isInserted ? { underline: false } : {}),
            ...(link === undefined ? {} : { link }),
          },
          fields: isInserted
            ? "bold,italic,underline,link"
            : "bold,italic,link",
        },
      };
    });
  }

  /** A link to a URL, or to the heading in this Doc a `#` target names. */
  private _linkOf(target: string | undefined): Link | undefined {
    if (target === undefined) {
      return undefined;
    }
    if (!target.startsWith("#")) {
      return { url: target };
    }
    const heading = [...this.headingTexts].find(
      ([, text]) => markdownDialect.headingTarget(text) === target,
    );
    if (heading === undefined) {
      throw new Error(`No heading in the Doc for the link "${target}".`);
    }
    return { heading: { id: heading[0] } };
  }
}

function writtenOf(block: ParsedBlock): WrittenBlock[] {
  if (block.kind === "paragraph") {
    return [
      {
        kind: "paragraph",
        level: block.level,
        list: undefined,
        chars: charsOf(block.spans),
      },
    ];
  }
  if (block.kind === "list") {
    const list = { listKind: block.listKind };
    return block.items.map((spans) => ({
      kind: "paragraph",
      level: undefined,
      list,
      chars: charsOf(spans),
    }));
  }
  return [{ kind: "table", rows: block.rows.map((row) => row.map(charsOf)) }];
}

function charsOf(spans: (SpanStyle & { text: string })[]): StyledChar[] {
  return spans.flatMap(({ text, ...style }) =>
    [...text].map((char) => ({ char, style })),
  );
}

function indicesOf(element: StructuralElement): Range {
  const { startIndex, endIndex } = element;
  if (startIndex === undefined || endIndex === undefined) {
    throw new Error("The writer needs a Doc read with its indices.");
  }
  return { startIndex, endIndex };
}

function hasPendingSuggestion(item: {
  suggestedInsertionIds?: string[];
  suggestedDeletionIds?: string[];
}): boolean {
  return (
    (item.suggestedInsertionIds?.length ?? 0) > 0 ||
    (item.suggestedDeletionIds?.length ?? 0) > 0
  );
}

/** A paragraph's inline Markdown, as the reader words it. */
function inlineOf(paragraph: WrittenParagraph): string {
  return markdownDialect
    .inline(
      paragraph.chars.map(({ char, style }) => ({
        ...style,
        markdown: markdownDialect
          .escaped(char)
          .replace(/\v/g, markdownDialect.syntax.lineBreak),
      })),
    )
    .trim();
}

/** The hunk's held and written paragraphs paired by position, as far as both run. */
function pairsOf(
  held: HeldBlock[],
  wanted: WrittenBlock[],
): { heldParagraph: HeldParagraph; wantedParagraph: WrittenParagraph }[] {
  return held.slice(0, wanted.length).flatMap((heldParagraph, position) => {
    const wantedParagraph = wanted[position];
    if (
      heldParagraph.kind !== "paragraph" ||
      wantedParagraph?.kind !== "paragraph"
    ) {
      return [];
    }
    return [{ heldParagraph, wantedParagraph }];
  });
}

/** Where each block lands inserted at `at`: a paragraph brings a newline, but none next to a table, which brings its own. */
function laidOut(
  blocks: WrittenBlock[],
  at: number,
  isBeforeNewline: boolean,
): LaidBlock[] {
  let cursor = at;
  return blocks.map((block, position) => {
    const previous = blocks[position - 1];
    const next = blocks[position + 1];
    let leading = "";
    let trailing = "";
    if (block.kind === "paragraph") {
      if (isBeforeNewline && previous?.kind !== "table") {
        leading = "\n";
      }
      if (!isBeforeNewline && next?.kind !== "table") {
        trailing = "\n";
      }
    }
    const startIndex = cursor + leading.length;
    cursor = startIndex + laidLengthOf(block) + trailing.length;
    return { block, startIndex, leading, trailing };
  });
}

/** A paragraph's text, or a table's whole length with the newline before it. */
function laidLengthOf(block: WrittenBlock): number {
  if (block.kind === "paragraph") {
    return unitLengthOf(block.chars);
  }
  const textLength = sumOf(block.rows.flat().map(unitLengthOf));
  return 1 + bareTableLengthOf(block) + textLength;
}

/** A table's length with empty cells: its own index, then its rows. */
function bareTableLengthOf(table: WrittenTable): number {
  const columns = table.rows[0]?.length ?? 0;
  return 1 + table.rows.length * rowLengthOf(columns);
}

/** Where an empty table's cell paragraph starts, from the table's index: past the table, the rows before, the row's and each cell's index. */
function cellOffsetOf(columns: number, row: number, column: number): number {
  return 1 + row * rowLengthOf(columns) + 1 + 2 * column + 1;
}

/** An empty table row's length: its own index, then per cell its index and newline. */
function rowLengthOf(columns: number): number {
  return 1 + 2 * columns;
}

function sumOf(lengths: number[]): number {
  return lengths.reduce((total, length) => total + length, 0);
}

/** How many characters the two share from their start, text alone. */
function sharedLength(left: StyledChar[], right: StyledChar[]): number {
  const differing = left.findIndex(
    (char, position) => char.char !== right[position]?.char,
  );
  if (differing === -1) {
    return Math.min(left.length, right.length);
  }
  return differing;
}

function changeOf(char: StyledChar, kept: StyledChar | undefined): CharChange {
  if (kept === undefined) {
    return "inserted";
  }
  if (markdownDialect.isSameStyle(kept.style, char.style)) {
    return "unchanged";
  }
  return "restyled";
}

function styleRunsOf(chars: RestyledChar[]): StyleRun[] {
  let offset = 0;
  return chars.reduce<StyleRun[]>((runs, { char, style, change }) => {
    const start = offset;
    offset += char.length;
    if (change === "unchanged") {
      return runs;
    }
    const last = runs.at(-1);
    if (
      last !== undefined &&
      last.end === start &&
      last.change === change &&
      markdownDialect.isSameStyle(last.style, style)
    ) {
      last.end = offset;
      return runs;
    }
    runs.push({ start, end: offset, style, change });
    return runs;
  }, []);
}

/** No bullet, then the paragraph's style with the list's indent reset, set outright so it keeps none from where it landed. */
function paragraphRequests(laid: LaidParagraph): Request[] {
  return [
    { deleteParagraphBullets: { range: paragraphRangeOf(laid) } },
    paragraphStyleRequest(laid, paragraphStyleFields.outright),
  ];
}

function paragraphStyleRequest(
  laid: LaidParagraph,
  fields: (typeof paragraphStyleFields)[keyof typeof paragraphStyleFields],
): Request {
  const { level } = laid.paragraph;
  const namedStyleType =
    level === undefined ? "NORMAL_TEXT" : headingStyleTypes[level - 1];
  return {
    updateParagraphStyle: {
      range: paragraphRangeOf(laid),
      paragraphStyle: { namedStyleType },
      fields,
    },
  };
}
