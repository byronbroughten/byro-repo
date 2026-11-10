// Parses the dialect's inline Markdown back into styled text: escapes, line
// breaks, bold, italic and links. `markdownDialect.ts` holds the forms it reads
// and is its one caller; nothing here knows the Docs API.

/** A stretch of plain text with one style, as parsed back from inline Markdown. */
export interface TextSpan {
  text: string;
  isBold: boolean;
  isItalic: boolean;
  target: string | undefined;
}

/** A link's opening: where its text ends, at the `](`, and its target. */
interface LinkOpening {
  textEnd: number;
  target: string;
}

export class InlineParser {
  private readonly inline: string;
  private readonly lineBreak: string;
  private readonly parsed: TextSpan[] = [];
  private span: TextSpan | undefined;
  private isBold = false;
  private isItalic = false;
  private target: string | undefined;
  private linkEnd: number | undefined;
  private position = 0;

  constructor(inline: string, lineBreak: string) {
    this.inline = inline;
    this.lineBreak = lineBreak;
  }

  static init(inline: string, lineBreak: string): InlineParser {
    return new InlineParser(inline, lineBreak);
  }

  /** The text, a new span starting wherever the style changes. */
  spans(): TextSpan[] {
    while (this.position < this.inline.length) {
      this._step();
    }
    return this.parsed;
  }

  private _step(): void {
    const rest = this.inline.slice(this.position);
    if (this.position === this.linkEnd) {
      this._closeLink();
      return;
    }
    if (rest.startsWith("\\") && rest.length > 1) {
      this._push(rest.charAt(1), 2);
      return;
    }
    if (rest.startsWith(this.lineBreak)) {
      this._push("\v", this.lineBreak.length);
      return;
    }
    const markers = /^\*{1,3}/.exec(rest)?.[0];
    if (markers !== undefined) {
      this._toggle(markers.length);
      return;
    }
    const link = rest.startsWith("[") ? this._linkOpening() : undefined;
    if (link !== undefined) {
      this._openLink(link);
      return;
    }
    this._push(rest.charAt(0), 1);
  }

  private _closeLink(): void {
    this.position = this.inline.indexOf(")", this.position) + 1;
    this.target = undefined;
    this.linkEnd = undefined;
    this.span = undefined;
  }

  /** Appends text read from the next `length` characters of Markdown. */
  private _push(text: string, length: number): void {
    this.position += length;
    if (this.span !== undefined) {
      this.span.text += text;
      return;
    }
    this.span = {
      text,
      isBold: this.isBold,
      isItalic: this.isItalic,
      target: this.target,
    };
    this.parsed.push(this.span);
  }

  /** `*` toggles italic, `**` bold and `***` both. */
  private _toggle(markerCount: number): void {
    if (markerCount >= 2) {
      this.isBold = !this.isBold;
    }
    if (markerCount !== 2) {
      this.isItalic = !this.isItalic;
    }
    this.position += markerCount;
    this.span = undefined;
  }

  private _linkOpening(): LinkOpening | undefined {
    let position = this.position + 1;
    while (position < this.inline.length) {
      const char = this.inline.charAt(position);
      if (char === "\\") {
        position += 2;
        continue;
      }
      if (char === "]") {
        const match = /^\]\(([^)]*)\)/.exec(this.inline.slice(position));
        if (match?.[1] === undefined) {
          return undefined;
        }
        return { textEnd: position, target: match[1] };
      }
      position += 1;
    }
    return undefined;
  }

  private _openLink({ textEnd, target }: LinkOpening): void {
    this.target = target;
    this.linkEnd = textEnd;
    this.position += 1;
    this.span = undefined;
  }
}
