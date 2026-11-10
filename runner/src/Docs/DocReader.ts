// Reads a `documents.get` body into the repo's Markdown dialect: headings,
// paragraphs, bold and italic, links, lists (nested and numbered), tables,
// footnotes and internal heading links. Pending suggested insertions are left
// out, a suggested paragraph split included, and empty paragraphs, such as those
// Docs keeps around a table, are dropped.
// The body types are `googleDocs.ts`'s; every Markdown form is `markdownDialect.ts`'s.

import type {
  Body,
  Bullet,
  DocumentTab,
  Footnote,
  GoogleDocument,
  Link,
  List,
  NamedStyleType,
  Paragraph,
  ParagraphElement,
  StructuralElement,
  Table,
} from "./googleDocs.ts";
import {
  type InlineRun,
  type MarkdownBlock,
  markdownDialect,
} from "./markdownDialect.ts";

const headingLevels: Partial<Record<NamedStyleType, number>> = {
  TITLE: 1,
  HEADING_1: 1,
  HEADING_2: 2,
  HEADING_3: 3,
  HEADING_4: 4,
  HEADING_5: 5,
  HEADING_6: 6,
};

const unorderedGlyphTypes = new Set([
  undefined,
  "GLYPH_TYPE_UNSPECIFIED",
  "NONE",
]);

export class DocReader {
  private readonly listOrdinals = new Map<string, number[]>();
  private pendingFootnotes: string[] = [];
  private readonly body: Body;
  private readonly lists: Record<string, List>;
  private readonly footnotes: Record<string, Footnote>;
  private readonly headingTexts: Map<string, string>;

  constructor(tab: Partial<DocumentTab>) {
    this.body = tab.body ?? { content: [] };
    this.lists = tab.lists ?? {};
    this.footnotes = tab.footnotes ?? {};
    this.headingTexts = headingTextsOf(this.body);
  }

  /** A reader of the Doc's first tab, or of its body when it was fetched without tabs. */
  static init(document: GoogleDocument): DocReader {
    return new DocReader(document.tabs?.[0]?.documentTab ?? document);
  }

  markdown(): string {
    this.listOrdinals.clear();
    this.pendingFootnotes = [];
    const blocks = withSuggestedSplitsJoined(this.body.content).flatMap(
      (element) => this._blocksOf(element),
    );
    return markdownDialect.document([...blocks, ...this._footnoteBlocks()]);
  }

  private _blocksOf(element: StructuralElement): MarkdownBlock[] {
    if (element.paragraph !== undefined) {
      return this._paragraphBlocks(element.paragraph);
    }
    if (element.table !== undefined && !isSuggestedInsertion(element.table)) {
      return [{ markdown: this._tableOf(element.table), isListItem: false }];
    }
    return [];
  }

  private _paragraphBlocks(paragraph: Paragraph): MarkdownBlock[] {
    const inline = this._inlineOf(paragraph).trim();
    if (inline === "") {
      return [];
    }
    const styleType = paragraph.paragraphStyle?.namedStyleType;
    const level =
      styleType === undefined ? undefined : headingLevels[styleType];
    if (level !== undefined) {
      const footnotes =
        level <= markdownDialect.syntax.sectionLevel
          ? this._footnoteBlocks()
          : [];
      const heading = markdownDialect.heading(level, inline);
      return [...footnotes, { markdown: heading, isListItem: false }];
    }
    if (paragraph.bullet !== undefined) {
      return [
        {
          markdown: this._listItemOf(paragraph.bullet, inline),
          isListItem: true,
        },
      ];
    }
    return [{ markdown: markdownDialect.paragraph(inline), isListItem: false }];
  }

  private _listItemOf(bullet: Bullet, inline: string): string {
    const { listId, nestingLevel = 0 } = bullet;
    const glyphType =
      this.lists[listId]?.listProperties.nestingLevels[nestingLevel]?.glyphType;
    const ordinals = (this.listOrdinals.get(listId) ?? []).slice(
      0,
      nestingLevel + 1,
    );
    const ordinal = (ordinals[nestingLevel] ?? 0) + 1;
    ordinals[nestingLevel] = ordinal;
    this.listOrdinals.set(listId, ordinals);
    return markdownDialect.listItem({
      depth: nestingLevel,
      ordinal: unorderedGlyphTypes.has(glyphType) ? undefined : ordinal,
      inline,
    });
  }

  private _tableOf(table: Table): string {
    const rows = table.tableRows.map((row) =>
      row.tableCells.map((cell) =>
        this._inlinesOf(cell.content).join(markdownDialect.syntax.lineBreak),
      ),
    );
    return markdownDialect.table(rows);
  }

  /** The inline Markdown of each non-empty paragraph in some content. */
  private _inlinesOf(content: StructuralElement[]): string[] {
    return withSuggestedSplitsJoined(content)
      .flatMap((element) =>
        element.paragraph === undefined ? [] : [element.paragraph],
      )
      .map((paragraph) => this._inlineOf(paragraph).trim())
      .filter((inline) => inline !== "");
  }

  private _inlineOf(paragraph: Paragraph): string {
    return markdownDialect.inline(
      paragraph.elements.flatMap((element) => this._runsOf(element)),
    );
  }

  private _runsOf(element: ParagraphElement): InlineRun[] {
    const { textRun, footnoteReference } = element;
    if (footnoteReference !== undefined) {
      if (isSuggestedInsertion(footnoteReference)) {
        return [];
      }
      const { footnoteId, footnoteNumber } = footnoteReference;
      this._holdFootnote(footnoteId, footnoteNumber);
      return [
        {
          markdown: markdownDialect.footnoteReference(footnoteNumber),
          isBold: false,
          isItalic: false,
          target: undefined,
        },
      ];
    }
    if (textRun === undefined || isSuggestedInsertion(textRun)) {
      return [];
    }
    const markdown = markdownDialect
      .escaped(textRun.content.replace(/\n$/, ""))
      .replace(/\v/g, markdownDialect.syntax.lineBreak);
    const style = textRun.textStyle ?? {};
    return [
      {
        markdown,
        isBold: style.bold === true,
        isItalic: style.italic === true,
        target: this._targetOf(style.link),
      },
    ];
  }

  private _targetOf(link: Link | undefined): string | undefined {
    if (link === undefined) {
      return undefined;
    }
    if (link.url !== undefined) {
      return link.url;
    }
    const headingId = link.heading?.id ?? link.headingId;
    const headingText =
      headingId === undefined ? undefined : this.headingTexts.get(headingId);
    if (headingText === undefined) {
      return undefined;
    }
    return markdownDialect.headingTarget(headingText);
  }

  private _holdFootnote(footnoteId: string, footnoteNumber: string): void {
    const footnote = this.footnotes[footnoteId];
    if (footnote === undefined) {
      return;
    }
    const inline = this._inlinesOf(footnote.content).join(" ");
    this.pendingFootnotes.push(
      markdownDialect.footnoteDefinition(footnoteNumber, inline),
    );
  }

  /** The footnote definitions held since the last Section, as one block. */
  private _footnoteBlocks(): MarkdownBlock[] {
    if (this.pendingFootnotes.length === 0) {
      return [];
    }
    const markdown = this.pendingFootnotes.join("\n");
    this.pendingFootnotes = [];
    return [{ markdown, isListItem: false }];
  }
}

function headingTextsOf(body: Body): Map<string, string> {
  return body.content.reduce((texts, element) => {
    const headingId = element.paragraph?.paragraphStyle?.headingId;
    if (element.paragraph !== undefined && headingId !== undefined) {
      texts.set(headingId, plainTextOf(element.paragraph));
    }
    return texts;
  }, new Map<string, string>());
}

/**
 * Joins each paragraph ended by a suggested newline to the paragraph after it,
 * which keeps its style, so a pending split reads as the one paragraph it was.
 */
function withSuggestedSplitsJoined(
  content: StructuralElement[],
): StructuralElement[] {
  return content.reduce<StructuralElement[]>((joined, element) => {
    const previous = joined.at(-1)?.paragraph;
    if (
      previous !== undefined &&
      element.paragraph !== undefined &&
      endsInSuggestedNewline(previous)
    ) {
      joined[joined.length - 1] = {
        ...element,
        paragraph: {
          ...element.paragraph,
          elements: [...previous.elements, ...element.paragraph.elements],
        },
      };
      return joined;
    }
    joined.push(element);
    return joined;
  }, []);
}

function endsInSuggestedNewline(paragraph: Paragraph): boolean {
  const textRun = paragraph.elements.at(-1)?.textRun;
  return (
    textRun !== undefined &&
    textRun.content.endsWith("\n") &&
    isSuggestedInsertion(textRun)
  );
}

function plainTextOf(paragraph: Paragraph): string {
  return paragraph.elements
    .map((element) =>
      element.textRun === undefined || isSuggestedInsertion(element.textRun)
        ? ""
        : element.textRun.content,
    )
    .join("")
    .trim();
}

function isSuggestedInsertion(item: {
  suggestedInsertionIds?: string[];
}): boolean {
  return (item.suggestedInsertionIds?.length ?? 0) > 0;
}
