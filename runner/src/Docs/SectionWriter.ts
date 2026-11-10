// Turns a Section's new Markdown into the `batchUpdate` requests that rewrite it
// in place in the document it was read from: blocks are diffed by
// `sectionDiff.ts`, only the changed paragraphs are touched, and inside each
// only the smallest differing range, so comments on unchanged text keep their
// anchors and unchanged headings their headingIds; a hunk holding a table is
// rewritten whole. Text requests run from the end of the body back, so each
// one's indices are the read document's; the bullets go last, by where each
// list ends up. Every paragraph inserted gets its style and bullets set, so it
// takes none from a neighbour. The Markdown is parsed by `markdownDialect.ts`,
// and `Docs.ts` sends the requests under the revision guard.

import {
  headingLevels,
  headingStyleTypes,
  headingTextsOf,
  listKindOf,
} from "./DocReader.ts";
import type {
  BulletPreset,
  GoogleDocument,
  Link,
  List,
  Paragraph,
  Request,
  StructuralElement,
  Table,
} from "./googleDocs.ts";
import {
  type ListKind,
  markdownDialect,
  type ParsedBlock,
  type SpanStyle,
} from "./markdownDialect.ts";
import {
  type HeldBlock,
  type HeldParagraph,
  type Hunk,
  sectionDiff,
  type StyledChar,
  type WrittenBlock,
  type WrittenParagraph,
  type WrittenTable,
} from "./sectionDiff.ts";

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

/** A written paragraph where the text requests leave it, and the held paragraph whose bullet it keeps. */
interface PlacedParagraph {
  paragraph: WrittenParagraph;
  startIndex: number;
  origin: HeldParagraph | undefined;
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

const bulletPresets: Record<ListKind, BulletPreset> = {
  bulleted: "BULLET_DISC_CIRCLE_SQUARE",
  numbered: "NUMBERED_DECIMAL_ALPHA_ROMAN",
};

export class SectionWriter {
  private readonly content: StructuralElement[];
  private readonly lists: Record<string, List>;
  private readonly headingTexts: Map<string, string>;
  private readonly bodyEndIndex: number;
  private readonly tableStartIndices: Set<number>;
  private readonly listSizes: Map<string, number>;

  constructor(document: GoogleDocument) {
    const body = document.body ?? { content: [] };
    this.content = body.content;
    this.lists = document.lists ?? {};
    this.headingTexts = headingTextsOf(body);
    this.bodyEndIndex = this.content.at(-1)?.endIndex ?? 1;
    this.tableStartIndices = new Set(
      this.content.flatMap(({ table, startIndex }) =>
        table === undefined || startIndex === undefined ? [] : [startIndex],
      ),
    );
    this.listSizes = this.content.reduce((sizes, { paragraph }) => {
      const listId = paragraph?.bullet?.listId;
      if (listId !== undefined) {
        sizes.set(listId, (sizes.get(listId) ?? 0) + 1);
      }
      return sizes;
    }, new Map<string, number>());
  }

  static init(document: GoogleDocument): SectionWriter {
    return new SectionWriter(document);
  }

  /** The requests that make the Section under `heading` read as `markdown`: text last index first, then bullets. */
  requestsFor(heading: string, markdown: string): Request[] {
    const { sectionHeading, held } = this._sectionOf(heading);
    const wanted = markdownDialect.blocksOf(markdown).flatMap(writtenOf);
    const changes: BodyChange[] = [];
    const placed: PlacedParagraph[] = [];
    let lengthChange = 0;
    sectionDiff.hunksOf(sectionHeading, held, wanted).forEach((hunk) => {
      const change = this._hunkChange(hunk);
      const shift = lengthChange;
      changes.push(change);
      placed.push(
        ...change.placed.map((paragraph) => ({
          ...paragraph,
          startIndex: paragraph.startIndex + shift,
        })),
      );
      lengthChange += change.lengthChange;
      const kept = hunk.kept;
      if (kept?.held.kind === "paragraph" && kept.wanted.kind === "paragraph") {
        placed.push({
          paragraph: kept.wanted,
          startIndex: kept.held.startIndex + lengthChange,
          origin: kept.held,
        });
      }
    });
    const textRequests = changes.reverse().flatMap(({ requests }) => requests);
    return [...textRequests, ...this._bulletRequests(placed)];
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
            : { kind: listKindOf(this.lists, bullet) },
        chars: this._charsOf(paragraph),
        bullet,
        ...indicesOf(element),
      },
    ];
  }

  /** Each cell's text, its paragraphs joined by line breaks as the reader joins them. */
  private _rowsOf(table: Table): StyledChar[][][] {
    if ((table.suggestedInsertionIds?.length ?? 0) > 0) {
      throw new Error("The writer takes no table with a pending suggestion.");
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
      if (
        textRun === undefined ||
        (textRun.suggestedInsertionIds?.length ?? 0) > 0 ||
        (textRun.suggestedDeletionIds?.length ?? 0) > 0
      ) {
        throw new Error(
          "The writer takes only plain text runs, with no footnote or pending suggestion.",
        );
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

  /**
   * Inserts first, at the hunk's end, then deletes and edits from the last
   * paragraph back; a hunk holding a table pairs nothing, so it is rewritten whole.
   */
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
        origin:
          heldParagraph.list?.kind === wantedParagraph.list?.kind
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
        this._editRequests(heldParagraph, wantedParagraph),
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

  /**
   * Inserts before the block at `index`, so existing newlines keep their
   * paragraphs; at the body's end or a table's start, where nothing can go,
   * before the newline of the paragraph ending there.
   */
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
        ? [{ paragraph: block, startIndex, origin: undefined }]
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
      const startIndex = at + leading.length;
      return [
        {
          insertText: {
            text: `${leading}${text}${trailing}`,
            location: { index: at },
          },
        },
        ...this._newParagraphRequests(startIndex, block),
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
      requests.push(...paragraphRequests(at, emptyParagraph));
    }
    if (isLast && isBeforeNewline) {
      const after = at + 1 + bareTableLengthOf(block);
      requests.push(...paragraphRequests(after, emptyParagraph));
    }
    return [...requests, ...this._cellRequests(block, at + 1)];
  }

  /** Fills each cell, the last first, with text and no newline, so no cell ends in an empty paragraph. */
  private _cellRequests(table: WrittenTable, tableStart: number): Request[] {
    const columns = table.rows[0]?.length ?? 0;
    return table.rows
      .flatMap((row, rowPosition) =>
        row.map((chars, columnPosition) => ({
          chars,
          startIndex:
            tableStart +
            3 +
            rowPosition * (1 + 2 * columns) +
            2 * columnPosition,
        })),
      )
      .reverse()
      .flatMap(({ chars, startIndex }) => {
        const paragraph = { ...emptyParagraph, chars };
        const text = chars.map(({ char }) => char).join("");
        return [
          ...(text === ""
            ? []
            : [{ insertText: { text, location: { index: startIndex } } }]),
          ...this._newParagraphRequests(startIndex, paragraph),
        ];
      });
  }

  /** A new paragraph's text styles, then its paragraph style and no bullet, whatever it landed in. */
  private _newParagraphRequests(
    startIndex: number,
    paragraph: WrittenParagraph,
  ): Request[] {
    const inserted = [...paragraph.chars, plainNewline].map((char) => ({
      ...char,
      change: "inserted" as const,
    }));
    return [
      ...this._textStyleRequests(startIndex, inserted),
      ...paragraphRequests(startIndex, paragraph),
    ];
  }

  /**
   * Deletes a block; a paragraph before the body's end or a table it isn't
   * deleted with only loses its text, since Docs keeps that newline.
   */
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
        ...paragraphRequests(startIndex, emptyParagraph),
      ],
      lengthChange: startIndex - (endIndex - 1),
      placed: [],
    };
  }

  /** Rewrites only the range between the text the two share at each end, then restyles what differs. */
  private _editRequests(
    held: HeldParagraph,
    wanted: WrittenParagraph,
  ): Request[] {
    const { startIndex } = held;
    const prefix = sharedLength(held.chars, wanted.chars);
    const suffix = sharedLength(
      held.chars.slice(prefix).reverse(),
      wanted.chars.slice(prefix).reverse(),
    );
    const heldEnd = held.chars.length - suffix;
    const wantedEnd = wanted.chars.length - suffix;
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
      const text = wanted.chars
        .slice(prefix, wantedEnd)
        .map(({ char }) => char)
        .join("");
      requests.push({ insertText: { text, location: { index: editIndex } } });
    }
    const shift = held.chars.length - wanted.chars.length;
    const restyled = wanted.chars.map((char, position) => {
      let kept: StyledChar | undefined;
      if (position < prefix) {
        kept = held.chars[position];
      } else if (position >= wantedEnd) {
        kept = held.chars[position + shift];
      }
      return { ...char, change: changeOf(char, kept) };
    });
    requests.push(...this._textStyleRequests(startIndex, restyled));
    if (held.level !== wanted.level) {
      requests.push(paragraphStyleRequest(startIndex, wanted));
    }
    if (held.bullet !== undefined && held.list?.kind !== wanted.list?.kind) {
      requests.push(bulletsDeletedRequest(startIndex, wanted));
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

  /**
   * Puts each written list in one list of its own, by where the text requests
   * left it, unless its items already make up the whole of one such list.
   */
  private _bulletRequests(placed: PlacedParagraph[]): Request[] {
    return listRunsOf(placed)
      .filter((run) => !this._isWholeList(run))
      .reverse()
      .flatMap((run) => {
        const first = run[0];
        const last = run.at(-1);
        const kind = first?.paragraph.list?.kind;
        if (first === undefined || last === undefined || kind === undefined) {
          return [];
        }
        const range = {
          startIndex: first.startIndex,
          endIndex: last.startIndex + unitLengthOf(last.paragraph.chars) + 1,
        };
        return [
          { deleteParagraphBullets: { range } },
          {
            createParagraphBullets: {
              range,
              bulletPreset: bulletPresets[kind],
            },
          },
        ];
      });
  }

  private _isWholeList(run: PlacedParagraph[]): boolean {
    const listIds = new Set(run.map(({ origin }) => origin?.bullet?.listId));
    const [listId] = listIds;
    const kind = run[0]?.paragraph.list?.kind;
    return (
      listIds.size === 1 &&
      listId !== undefined &&
      listKindOf(this.lists, { listId }) === kind &&
      this.listSizes.get(listId) === run.length
    );
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
    const list = { kind: block.listKind };
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

function indicesOf(element: StructuralElement): {
  startIndex: number;
  endIndex: number;
} {
  const { startIndex, endIndex } = element;
  if (startIndex === undefined || endIndex === undefined) {
    throw new Error("The writer needs a Doc read with its indices.");
  }
  return { startIndex, endIndex };
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

/**
 * Where each block lands when all are inserted at `at`: a paragraph brings its
 * newline after it, or, before a newline already there, before it; a table
 * brings its own newline before it, so a paragraph next to one brings none.
 */
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

/** A table's length with empty cells: its own index, and per row one plus two per cell. */
function bareTableLengthOf(table: WrittenTable): number {
  const columns = table.rows[0]?.length ?? 0;
  return 1 + table.rows.length * (1 + 2 * columns);
}

/** The placed list items in runs, one per written list. */
function listRunsOf(placed: PlacedParagraph[]): PlacedParagraph[][] {
  return placed.reduce<PlacedParagraph[][]>((runs, paragraph) => {
    const { list } = paragraph.paragraph;
    if (list === undefined) {
      return runs;
    }
    const run = runs.at(-1);
    if (run?.at(-1)?.paragraph.list === list) {
      run.push(paragraph);
      return runs;
    }
    runs.push([paragraph]);
    return runs;
  }, []);
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

/** The characters' length in the UTF-16 code units Docs indices count. */
function unitLengthOf(chars: StyledChar[]): number {
  return chars.reduce((length, { char }) => length + char.length, 0);
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

/** A paragraph's style and no bullet, set outright so it keeps none from where it landed. */
function paragraphRequests(
  startIndex: number,
  paragraph: WrittenParagraph,
): Request[] {
  return [
    paragraphStyleRequest(startIndex, paragraph),
    bulletsDeletedRequest(startIndex, paragraph),
  ];
}

function paragraphStyleRequest(
  startIndex: number,
  paragraph: WrittenParagraph,
): Request {
  const namedStyleType =
    paragraph.level === undefined
      ? "NORMAL_TEXT"
      : headingStyleTypes[paragraph.level - 1];
  return {
    updateParagraphStyle: {
      range: paragraphRangeOf(startIndex, paragraph),
      paragraphStyle: { namedStyleType },
      fields: "namedStyleType",
    },
  };
}

function bulletsDeletedRequest(
  startIndex: number,
  paragraph: WrittenParagraph,
): Request {
  return {
    deleteParagraphBullets: { range: paragraphRangeOf(startIndex, paragraph) },
  };
}

function paragraphRangeOf(
  startIndex: number,
  { chars }: WrittenParagraph,
): { startIndex: number; endIndex: number } {
  return { startIndex, endIndex: startIndex + unitLengthOf(chars) + 1 };
}
