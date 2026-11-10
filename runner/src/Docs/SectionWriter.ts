// Turns a Section's new Markdown into the `batchUpdate` requests that rewrite it
// in place in the document it was read from: paragraphs are diffed, only the
// changed ones are touched, and inside each only the smallest differing range,
// so comments on unchanged text keep their anchors and unchanged headings their
// headingIds. Requests run from the end of the body back, so each one's indices
// are the read document's. Headings and paragraphs only; the Markdown is parsed
// by `markdownDialect.ts`, and `Docs.ts` sends the requests under the revision guard.

import { headingLevels, headingTextsOf } from "./DocReader.ts";
import type {
  GoogleDocument,
  Link,
  NamedStyleType,
  Paragraph,
  Request,
  StructuralElement,
} from "./googleDocs.ts";
import {
  markdownDialect,
  type ParsedBlock,
  type SpanStyle,
} from "./markdownDialect.ts";

interface StyledChar {
  char: string;
  style: SpanStyle;
}

/** A heading or paragraph as the writer compares it: its level and its text, one character at a time. */
interface WrittenParagraph {
  level: number | undefined;
  chars: StyledChar[];
}

/** A paragraph of the read document, with where it sits. */
interface HeldParagraph extends WrittenParagraph {
  startIndex: number;
  endIndex: number;
}

/** A run of paragraphs that differ between the document and the Markdown, after the paragraph ending at `afterIndex`. */
interface Hunk {
  held: HeldParagraph[];
  wanted: WrittenParagraph[];
  afterIndex: number;
}

const headingStyleTypes = [
  "HEADING_1",
  "HEADING_2",
  "HEADING_3",
  "HEADING_4",
  "HEADING_5",
  "HEADING_6",
] as const satisfies NamedStyleType[];

export class SectionWriter {
  private readonly content: StructuralElement[];
  private readonly headingTexts: Map<string, string>;
  private readonly bodyEndIndex: number;

  constructor(document: GoogleDocument) {
    const body = document.body ?? { content: [] };
    this.content = body.content;
    this.headingTexts = headingTextsOf(body);
    this.bodyEndIndex = this.content.at(-1)?.endIndex ?? 1;
  }

  static init(document: GoogleDocument): SectionWriter {
    return new SectionWriter(document);
  }

  /** The requests that make the Section under `heading` read as `markdown`, last index first. */
  requestsFor(heading: string, markdown: string): Request[] {
    const { sectionHeading, held } = this._sectionOf(heading);
    const wanted = markdownDialect.blocksOf(markdown).map(writtenOf);
    return hunksOf(sectionHeading, held, wanted)
      .reverse()
      .flatMap((hunk) => this._hunkRequests(hunk));
  }

  private _sectionOf(heading: string): {
    sectionHeading: HeldParagraph;
    held: HeldParagraph[];
  } {
    const paragraphs = this.content.flatMap((element) => {
      if (element.table !== undefined) {
        throw new Error("The writer takes no Doc with a table yet.");
      }
      return element.paragraph === undefined
        ? []
        : [this._heldOf(element, element.paragraph)];
    });
    const written = paragraphs.filter(
      (paragraph) => paragraph.chars.length > 0,
    );
    const start = written.findIndex(
      (paragraph) =>
        paragraph.level === markdownDialect.syntax.sectionLevel &&
        inlineOf(paragraph) === heading,
    );
    const sectionHeading = written[start];
    if (sectionHeading === undefined) {
      throw new Error(`No Section "${heading}".`);
    }
    const after = written.slice(start + 1);
    const end = after.findIndex(
      (paragraph) =>
        paragraph.level !== undefined &&
        paragraph.level <= markdownDialect.syntax.sectionLevel,
    );
    return {
      sectionHeading,
      held: end === -1 ? after : after.slice(0, end),
    };
  }

  private _heldOf(
    element: StructuralElement,
    paragraph: Paragraph,
  ): HeldParagraph {
    const { startIndex, endIndex } = element;
    if (startIndex === undefined || endIndex === undefined) {
      throw new Error("The writer needs a Doc read with its indices.");
    }
    if (paragraph.bullet !== undefined) {
      throw new Error("The writer takes no Doc with a list yet.");
    }
    const chars = paragraph.elements.flatMap(({ textRun }) => {
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
    const styleType = paragraph.paragraphStyle?.namedStyleType;
    const level =
      styleType === undefined ? undefined : headingLevels[styleType];
    return { level, chars, startIndex, endIndex };
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

  /** Inserts first, at the hunk's end, then deletes and edits from the last paragraph back. */
  private _hunkRequests({ held, wanted, afterIndex }: Hunk): Request[] {
    const pairedCount = Math.min(held.length, wanted.length);
    const insertAt = held.at(-1)?.endIndex ?? afterIndex;
    const inserts = this._insertRequests(wanted.slice(pairedCount), insertAt);
    const deletes = held
      .slice(pairedCount)
      .reverse()
      .flatMap((paragraph) => this._deleteRequests(paragraph));
    const edits = held
      .slice(0, pairedCount)
      .map((paragraph, position) => ({ paragraph, position }))
      .reverse()
      .flatMap(({ paragraph, position }) => {
        const paired = wanted[position];
        return paired === undefined
          ? []
          : this._editRequests(paragraph, paired);
      });
    return [...inserts, ...deletes, ...edits];
  }

  /**
   * Inserts new paragraphs before the paragraph starting at `index`, so every
   * newline already there stays with its paragraph; at the body's end, where
   * nothing can follow the last newline, they go before it instead.
   */
  private _insertRequests(
    paragraphs: WrittenParagraph[],
    index: number,
  ): Request[] {
    if (paragraphs.length === 0) {
      return [];
    }
    const texts = paragraphs.map(({ chars }) =>
      chars.map(({ char }) => char).join(""),
    );
    const insertText =
      index === this.bodyEndIndex
        ? { text: `\n${texts.join("\n")}`, location: { index: index - 1 } }
        : { text: `${texts.join("\n")}\n`, location: { index } };
    let startIndex = index;
    const styles = paragraphs.flatMap((paragraph) => {
      const requests = [
        paragraphStyleRequest(startIndex, paragraph),
        ...this._textStyleRequests(
          startIndex,
          paragraph.chars.map((char) => ({ ...char, isChanged: true })),
        ),
      ];
      startIndex += paragraph.chars.length + 1;
      return requests;
    });
    return [{ insertText }, ...styles];
  }

  /** Deletes a paragraph; the body's last one only loses its text, since its newline can't go. */
  private _deleteRequests(paragraph: HeldParagraph): Request[] {
    const { startIndex, endIndex } = paragraph;
    if (endIndex !== this.bodyEndIndex) {
      return [{ deleteContentRange: { range: { startIndex, endIndex } } }];
    }
    const emptied = { level: undefined, chars: [] };
    return [
      { deleteContentRange: { range: { startIndex, endIndex: endIndex - 1 } } },
      paragraphStyleRequest(startIndex, emptied),
    ];
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
    const requests: Request[] = [];
    if (heldEnd > prefix) {
      requests.push({
        deleteContentRange: {
          range: {
            startIndex: startIndex + prefix,
            endIndex: startIndex + heldEnd,
          },
        },
      });
    }
    if (wantedEnd > prefix) {
      const text = wanted.chars
        .slice(prefix, wantedEnd)
        .map(({ char }) => char)
        .join("");
      requests.push({
        insertText: { text, location: { index: startIndex + prefix } },
      });
    }
    const shift = held.chars.length - wanted.chars.length;
    const restyled = wanted.chars.map((char, position) => {
      const kept =
        position < prefix
          ? held.chars[position]
          : position >= wantedEnd
            ? held.chars[position + shift]
            : undefined;
      return {
        ...char,
        isChanged: kept === undefined || !isSameStyle(kept.style, char.style),
      };
    });
    requests.push(...this._textStyleRequests(startIndex, restyled));
    if (held.level !== wanted.level) {
      requests.push(paragraphStyleRequest(startIndex, wanted));
    }
    return requests;
  }

  /** One style request per run of changed characters sharing a style. */
  private _textStyleRequests(
    startIndex: number,
    chars: (StyledChar & { isChanged: boolean })[],
  ): Request[] {
    const runs = chars.reduce<
      { start: number; end: number; style: SpanStyle }[]
    >((held, { style, isChanged }, position) => {
      if (!isChanged) {
        return held;
      }
      const last = held.at(-1);
      if (
        last !== undefined &&
        last.end === position &&
        isSameStyle(last.style, style)
      ) {
        last.end += 1;
        return held;
      }
      held.push({ start: position, end: position + 1, style });
      return held;
    }, []);
    return runs.map(({ start, end, style }) => {
      const link = this._linkOf(style.target);
      return {
        updateTextStyle: {
          range: { startIndex: startIndex + start, endIndex: startIndex + end },
          textStyle: {
            bold: style.isBold,
            italic: style.isItalic,
            ...(link === undefined ? {} : { link }),
          },
          fields: "bold,italic,link",
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

function writtenOf(block: ParsedBlock): WrittenParagraph {
  return {
    level: block.level,
    chars: block.spans.flatMap(({ text, ...style }) =>
      [...text].map((char) => ({ char, style })),
    ),
  };
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

/** The paragraphs that differ, between the runs a longest common subsequence keeps. */
function hunksOf(
  sectionHeading: HeldParagraph,
  held: HeldParagraph[],
  wanted: WrittenParagraph[],
): Hunk[] {
  const heldKeys = held.map(keyOf);
  const wantedKeys = wanted.map(keyOf);
  const lengths = heldKeys.map(() =>
    new Array<number>(wanted.length + 1).fill(0),
  );
  lengths.push(new Array<number>(wanted.length + 1).fill(0));
  for (let i = held.length - 1; i >= 0; i -= 1) {
    for (let j = wanted.length - 1; j >= 0; j -= 1) {
      const row = lengths[i] ?? [];
      row[j] =
        heldKeys[i] === wantedKeys[j]
          ? (lengths[i + 1]?.[j + 1] ?? 0) + 1
          : Math.max(lengths[i + 1]?.[j] ?? 0, row[j + 1] ?? 0);
    }
  }
  const hunks: Hunk[] = [];
  let hunk: Hunk = {
    held: [],
    wanted: [],
    afterIndex: sectionHeading.endIndex,
  };
  let i = 0;
  let j = 0;
  while (i < held.length || j < wanted.length) {
    const heldParagraph = held[i];
    const wantedParagraph = wanted[j];
    if (
      heldParagraph !== undefined &&
      wantedParagraph !== undefined &&
      heldKeys[i] === wantedKeys[j]
    ) {
      hunks.push(hunk);
      hunk = { held: [], wanted: [], afterIndex: heldParagraph.endIndex };
      i += 1;
      j += 1;
    } else if (
      heldParagraph !== undefined &&
      (wantedParagraph === undefined ||
        (lengths[i + 1]?.[j] ?? 0) >= (lengths[i]?.[j + 1] ?? 0))
    ) {
      hunk.held.push(heldParagraph);
      i += 1;
    } else if (wantedParagraph !== undefined) {
      hunk.wanted.push(wantedParagraph);
      j += 1;
    }
  }
  hunks.push(hunk);
  return hunks.filter(
    (candidate) => candidate.held.length > 0 || candidate.wanted.length > 0,
  );
}

function keyOf({ level, chars }: WrittenParagraph): string {
  return JSON.stringify([
    level,
    chars.map(({ char, style }) => [
      char,
      style.isBold,
      style.isItalic,
      style.target,
    ]),
  ]);
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

function isSameStyle(left: SpanStyle, right: SpanStyle): boolean {
  return (
    left.isBold === right.isBold &&
    left.isItalic === right.isItalic &&
    left.target === right.target
  );
}

function paragraphStyleRequest(
  startIndex: number,
  { level, chars }: WrittenParagraph,
): Request {
  const namedStyleType =
    level === undefined ? "NORMAL_TEXT" : headingStyleTypes[level - 1];
  return {
    updateParagraphStyle: {
      range: { startIndex, endIndex: startIndex + chars.length + 1 },
      paragraphStyle: { namedStyleType },
      fields: "namedStyleType",
    },
  };
}
