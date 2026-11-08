// Renders a word of mvdan/sh's syntax tree as the text bash hands the command, its quotes and escapes removed, for SegmentReader.ts and ../ShellParser.ts.
// A substitution stands as substitutionWord; a parameter, arithmetic or glob expansion keeps its source text, as only bash knows its value.
import type { Assign, Node, Word, WordPart } from "sh-syntax";

import { syntaxNodes } from "./syntaxNodes.ts";

// Its `$` and braces make it no program name and no plain path.
export const substitutionWord = "${substitution}";
const ansiCEscapes: Record<string, string> = {
  a: "\x07",
  b: "\b",
  e: "\x1b",
  E: "\x1b",
  f: "\f",
  n: "\n",
  r: "\r",
  t: "\t",
  v: "\v",
};

export class WordRenderer {
  // Node offsets count UTF-8 bytes.
  readonly source: Buffer;
  constructor(source: Buffer) {
    this.source = source;
  }
  static init(command: string): WordRenderer {
    return new WordRenderer(Buffer.from(command));
  }
  wordOf(word: Word): string {
    return word.parts.map((part) => this._partOf(part, false)).join("");
  }
  // A quote or backslash anywhere in a heredoc's delimiter quotes it, so bash expands nothing in its body.
  isQuoted(word: Word): boolean {
    return word.parts.some(
      (part) => part.type !== "Lit" || part.value.includes("\\"),
    );
  }
  // `name=value`, the shape SegmentReader.ts's withoutWrappersOf drops, so a wrapper's env assignment leaves the command words.
  assignOf(assign: Assign): string {
    const { name, value } = assign;
    if (assign.naked) return name?.value ?? (value ? this.wordOf(value) : "");
    if (assign.index || assign.array) return this.sourceOf(assign);
    const operator = assign.append ? "+=" : "=";
    return `${name?.value ?? ""}${operator}${value ? this.wordOf(value) : ""}`;
  }
  // The node's source text, each substitution inside it swapped for substitutionWord.
  sourceOf(node: Node): string {
    const substitutions = syntaxNodes
      .substitutionsIn(node)
      .sort((a, b) => a.start - b.start);
    const starts = [node.start, ...substitutions.map(({ end }) => end)];
    const ends = [...substitutions.map(({ start }) => start), node.end];
    return starts
      .map((start, at) => this._textBetween(start, ends[at] ?? node.end))
      .join(substitutionWord);
  }
  _partOf(part: WordPart, isInDoubleQuotes: boolean): string {
    if (part.type === "Lit") {
      return isInDoubleQuotes
        ? part.value.replace(/\\([$`"\\\n])/g, unescapedOf)
        : part.value.replace(/\\([^]?)/g, unescapedOf);
    }
    if (part.type === "SglQuoted") {
      return part.dollar ? ansiCDecodedOf(part.value) : part.value;
    }
    if (part.type === "DblQuoted") {
      return part.parts.map((inner) => this._partOf(inner, true)).join("");
    }
    if (part.type === "CmdSubst" || part.type === "ProcSubst") {
      return substitutionWord;
    }
    return this.sourceOf(part);
  }
  _textBetween(start: number, end: number): string {
    return this.source.subarray(start, end).toString();
  }
}

// A backslash before a newline joins the lines.
function unescapedOf(_match: string, char: string): string {
  return char === "\n" ? "" : char;
}

// `$'…'` text as bash decodes it; an escape bash doesn't know keeps its backslash.
function ansiCDecodedOf(value: string): string {
  return value.replace(
    /\\(?:([0-7]{1,3})|x([\da-fA-F]{1,2})|u([\da-fA-F]{1,4})|U([\da-fA-F]{1,8})|c([^])|([^]))/g,
    (
      match: string,
      octal?: string,
      hex?: string,
      unicode?: string,
      wideUnicode?: string,
      control?: string,
      other?: string,
    ) => {
      const code =
        codeOf(octal, 8) ?? codeOf(hex ?? unicode ?? wideUnicode, 16);
      if (code !== undefined) return String.fromCodePoint(code);
      if (control !== undefined) {
        return String.fromCharCode(control.charCodeAt(0) & 0x1f);
      }
      if (other === undefined) return match;
      if (`\\'"?`.includes(other)) return other;
      return ansiCEscapes[other] ?? match;
    },
  );
}

function codeOf(digits: string | undefined, radix: number): number | undefined {
  if (digits === undefined) return undefined;
  const code = Number.parseInt(digits, radix);
  return code <= 0x10ffff ? code : undefined;
}
