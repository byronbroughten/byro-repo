// Reads the Section `SectionWriter.ts` rewrites out of the document as held
// blocks: each paragraph's styled characters and each table's cells, with their
// indices. It refuses what the writer can't index around, a pending suggestion,
// a footnote or a nested list.

import { headingLevels, headingTextsOf, listKindOf } from "../DocReader.ts";
import type {
  GoogleDocument,
  Link,
  List,
  Paragraph,
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

  constructor(document: GoogleDocument) {
    const body = document.body ?? { content: [] };
    this.document = document;
    this.content = body.content;
    this.lists = document.lists ?? {};
    this.headingTexts = headingTextsOf(body);
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
