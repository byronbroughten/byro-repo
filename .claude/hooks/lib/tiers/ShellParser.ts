// Parses a Bash command into its simple commands, for the tier gate, the branch guard and BashReads; throws on an unbalanced quote.
// ShellParser/SegmentReader.ts reads the tokens through loops, conditionals, groups, substitutions and functions.
import { type Heredoc, HeredocScanner } from "./ShellParser/HeredocScanner.ts";
import {
  pipes,
  type Segment,
  SegmentReader,
  type SegmentReading,
  type Token,
} from "./ShellParser/SegmentReader.ts";
import {
  closingQuoteOf,
  SubstitutionScanner,
} from "./ShellParser/SubstitutionScanner.ts";

const separators = new Set([";", ";;", "&&", "||", "&", "$(", "(", ")", "`"]);

// isBare: no wrapper or env assignment was dropped from its words.
export interface SimpleCommand {
  words: string[];
  isBare: boolean;
}

export class ShellParser {
  readonly command: string;
  constructor(command: string) {
    this.command = command;
  }
  static init(command: string): ShellParser {
    return new ShellParser(command);
  }
  // Keeps a bare redirect such as `> file`, which has no words but writes. Never throws on compound syntax it can't read, as the branch guard and BashReads read a throw as nothing to refuse.
  get simpleCommands(): SimpleCommand[] {
    return simpleCommandsOf(this.segments);
  }
  // The simple commands of every layer of `$(…)` and backtick substitution, quoted or not, each substitution a word of its own in the layer around it; throws on one left open, on compound syntax it can't read as bash would, and on a call of a function another layer defines.
  get substitutedCommands(): SimpleCommand[] {
    const readings = SubstitutionScanner.init(
      this._withoutHeredocBodies,
    ).layers.map((layer) => ShellParser.init(layer).reading);
    readings.forEach((reading, at) => {
      if (!reading.isReadable) {
        throw new Error("The call holds compound syntax the gate can't read.");
      }
      const isCallingOtherLayer = readings.some(
        (other, otherAt) =>
          otherAt !== at &&
          [...other.functionNames].some((name) =>
            reading.calledNames.has(name),
          ),
      );
      if (isCallingOtherLayer) {
        throw new Error("The call runs a function across a substitution.");
      }
    });
    return readings.flatMap(({ segments }) => simpleCommandsOf(segments));
  }
  // Undefined for a command the gate can't parse, which callers leave to another rule.
  get parsedCommands(): SimpleCommand[] | undefined {
    try {
      return this.substitutedCommands;
    } catch {
      return undefined;
    }
  }
  // Undefined unless the heredoc scan strips the bodies the text match does; beside a heredoc, a substitution, `${…}`, `$'…'` or `((` nests quotes or `<<` in ways that scan doesn't follow.
  get heredocs(): Heredoc[] | undefined {
    let scan;
    try {
      scan = HeredocScanner.init(this.command).scan;
    } catch {
      return undefined;
    }
    if (scan.withoutBodies !== this._withoutHeredocBodies) return undefined;
    const hasNesting = /\$[({']|`|\(\(/.test(scan.withoutBodies);
    if (scan.heredocs.length > 0 && hasNesting) return undefined;
    return scan.heredocs;
  }
  // No `$'…'`, which the parse misreads, and every heredoc one the scan confirms behind a quoted delimiter, so neither hides a command from the parse.
  get isPlainText(): boolean {
    return (
      !/\$'/.test(this.command) &&
      (this.heredocs?.every(({ isQuoted }) => isQuoted) ?? false)
    );
  }
  // Every operator `&&`, no word holding a substitution and no command nested or negated by `!`, so each command runs only once all before it succeeded, in the same shell.
  get isAndList(): boolean {
    const isJoinedByAnd = this._tokens.every(({ type, value }) =>
      type === "op" ? value === "&&" : !/\$\(|`/.test(value),
    );
    return isJoinedByAnd && this.segments.every(({ isNested }) => !isNested);
  }
  // Each operator and redirect between the words, in order, a heredoc's `<<` included.
  get operators(): string[] {
    return this._tokens
      .filter(({ type }) => type !== "word")
      .map(({ value }) => value);
  }
  get segments(): Segment[] {
    return this.reading.segments;
  }
  get reading(): SegmentReading {
    return SegmentReader.init(this._tokens).read();
  }
  get _tokens(): Token[] {
    const command = this._withoutHeredocBodies;
    const tokens: Token[] = [];
    let word: string | undefined;
    let isQuoted = false;
    function endWord(): void {
      if (word !== undefined) {
        tokens.push({
          type: "word",
          value: word,
          ...(isQuoted ? { isQuoted } : {}),
        });
      }
      word = undefined;
      isQuoted = false;
    }
    for (let i = 0; i < command.length; i++) {
      const char = command.charAt(i);
      const next = command[i + 1];
      if (char === "'" || char === '"') {
        const close = closingQuoteOf(command, i);
        word =
          (word ?? "") +
          command
            .slice(i + 1, close)
            .replace(/\\(["\\$`])/g, char === '"' ? "$1" : "\\$1");
        isQuoted = true;
        i = close;
      } else if (char === "\\") {
        if (next !== "\n") {
          word = (word ?? "") + (next ?? "");
          isQuoted = true;
        }
        i++;
      } else if (char === " " || char === "\t") {
        endWord();
      } else if (char === "#" && word === undefined) {
        while (i + 1 < command.length && command[i + 1] !== "\n") i++;
      } else if (char === "\n") {
        endWord();
        tokens.push({ type: "op", value: ";" });
      } else if (char === "$" && next === "(") {
        endWord();
        tokens.push({ type: "op", value: "$(" });
        i++;
      } else if (
        char === "<" ||
        char === ">" ||
        (char === "&" && next === ">")
      ) {
        if (word !== undefined && /^\d+$/.test(word)) word = undefined;
        endWord();
        let value = char;
        while (/[<>&|]/.test(command[i + 1] ?? "") && value.length < 3) {
          value += command.charAt(++i);
        }
        tokens.push({ type: "redirect", value });
      } else if (
        char === "|" ||
        char === "&" ||
        char === ";" ||
        char === "(" ||
        char === ")" ||
        char === "`"
      ) {
        endWord();
        const pair = char + (next ?? "");
        const value = ["||", "&&", "|&", ";;"].includes(pair) ? pair : char;
        if (value.length === 2) i++;
        tokens.push({
          type: "op",
          value: separators.has(value) || pipes.has(value) ? value : ";",
        });
      } else {
        word = (word ?? "") + char;
      }
    }
    endWord();
    return tokens;
  }
  get _withoutHeredocBodies(): string {
    const kept: string[] = [];
    const pending: string[] = [];
    for (const line of this.command.split("\n")) {
      if (pending.length > 0) {
        if (line.trim() === pending[0]) pending.shift();
        continue;
      }
      kept.push(line);
      for (const match of line.matchAll(/<<-?\s*(['"]?)([\w.-]+)\1/g)) {
        pending.push(match[2] ?? "");
      }
    }
    return kept.join("\n");
  }
}

function simpleCommandsOf(segments: Segment[]): SimpleCommand[] {
  return segments
    .filter(
      ({ commandWords, outputFiles }) =>
        commandWords.length > 0 || outputFiles.length > 0,
    )
    .map(({ words, commandWords }) => ({
      words: commandWords,
      isBare: commandWords.length === words.length,
    }));
}
