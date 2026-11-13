// Reads the Section `SectionWriter.ts` rewrites out of the document as held
// blocks: each paragraph's styled characters and each table's cells, with their
// indices. It refuses what the writer can't index around: a pending suggestion
// anywhere in the Doc, and in the Section an element other than text, such as a
// footnote, image or page break. Outside the Section, or alone after its last
// text, such an element is left where it is, since the writer uses only the
// indices Docs gives. A nested list item is held like any other, and
// `sectionDiff.ts` never keeps one, so the writer replaces it.

import { headingLevels, headingTextsOf, listKindOf } from "../DocReader.ts";
import type {
  GoogleDocument,
  Link,
  List,
  Paragraph,
  ParagraphElement,
  Range,
  StructuralElement,
  Table,
} from "../googleDocs.ts";
import { markdownDialect } from "../markdownDialect.ts";
import { PendingSuggestions } from "../PendingSuggestions.ts";
import type {
  HeldBlock,
  HeldParagraph,
  StyledChar,
  WrittenParagraph,
} from "../sectionDiff.ts";

export class HeldSectionReader {
  private readonly document: GoogleDocument;
  private readonly content: StructuralElement[];
  private readonly lists: Record<string, List>;
  private readonly headingTexts: Map<string, string>;
  /** Where each block holding an element other than text starts. */
  private readonly nonTextStarts: Set<number>;

  constructor(document: GoogleDocument) {
    const body = document.body ?? { content: [] };
    this.document = document;
    this.content = body.content;
    this.lists = document.lists ?? {};
    this.headingTexts = headingTextsOf(body);
    this.nonTextStarts = new Set(
      this.content.flatMap((element) =>
        holdsNonText(element) ? [indicesOf(element).startIndex] : [],
      ),
    );
  }

  static init(document: GoogleDocument): HeldSectionReader {
    return new HeldSectionReader(document);
  }

  /** The Section's heading and the blocks held under it. */
  sectionOf(heading: string): {
    sectionHeading: HeldParagraph;
    held: HeldBlock[];
  } {
    const written = this.content
      .flatMap((element) => this._heldBlocksOf(element))
      .filter(
        (block) =>
          block.kind === "table" ||
          block.chars.length > 0 ||
          this.nonTextStarts.has(block.startIndex),
      );
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
    const held = withoutTrailingNonText(
      end === -1 ? after : after.slice(0, end),
    );
    if (
      [sectionHeading, ...held].some((block) =>
        this.nonTextStarts.has(block.startIndex),
      )
    ) {
      throw new Error(
        `The writer takes only text in the Section "${heading}", not a footnote, image or page break.`,
      );
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
              joined.push({
                char: "\v",
                style: { isBold: false, isItalic: false, target: undefined },
              });
            }
            joined.push(...chars);
            return joined;
          }, []),
      ),
    );
  }

  private _charsOf(paragraph: Paragraph): StyledChar[] {
    return paragraph.elements.flatMap((element) => {
      if (hasPendingSuggestion(kindOf(element))) {
        throw new PendingSuggestions(this.document.documentId);
      }
      const { textRun } = element;
      if (textRun === undefined) {
        return [];
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
}

// A page break or image alone after a Section's last text, as before the next part's title, stays put; the writer writes before it.
function withoutTrailingNonText(held: HeldBlock[]): HeldBlock[] {
  const lastWithText = held.findLastIndex(
    (block) => block.kind === "table" || block.chars.length > 0,
  );
  return held.slice(0, lastWithText + 1);
}

function holdsNonText({ paragraph, table }: StructuralElement): boolean {
  const paragraphs =
    table === undefined
      ? [paragraph]
      : table.tableRows.flatMap((row) =>
          row.tableCells.flatMap((cell) =>
            cell.content.map((cellElement) => cellElement.paragraph),
          ),
        );
  return paragraphs.some(
    (held) =>
      held?.elements.some((element) => element.textRun === undefined) === true,
  );
}

// Every kind's field, typed here or not, such as an image's, since a suggested one shifts the indices after it.
function kindOf(element: ParagraphElement): SuggestionMarks {
  const { startIndex: _start, endIndex: _end, ...kinds } = element;
  return Object.values(kinds).find(isSuggestionMarks) ?? {};
}

function isSuggestionMarks(value: unknown): value is SuggestionMarks {
  return typeof value === "object" && value !== null;
}

interface SuggestionMarks {
  suggestedInsertionIds?: string[];
  suggestedDeletionIds?: string[];
}

function indicesOf(element: StructuralElement): Range {
  const { startIndex, endIndex } = element;
  if (startIndex === undefined || endIndex === undefined) {
    throw new Error("The writer needs a Doc read with its indices.");
  }
  return { startIndex, endIndex };
}

function hasPendingSuggestion(item: SuggestionMarks): boolean {
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
