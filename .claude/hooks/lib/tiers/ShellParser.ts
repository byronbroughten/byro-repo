// Parses a Bash command into its simple commands, for the tier gate, the branch guard and BashReads; throws on an unbalanced quote.
import { closingQuoteOf, SubstitutionScanner } from "./SubstitutionScanner.ts";

const wrappers = new Set([
  "sudo",
  "command",
  "env",
  "time",
  "nice",
  "nohup",
  "exec",
  "builtin",
]);
const operators = {
  separators: new Set([";", "&&", "||", "&", "$(", "(", ")", "`"]),
  pipes: new Set(["|", "|&"]),
} as const;

// commandWords: its words with leading wrappers and env assignments dropped.
export interface Segment {
  words: string[];
  commandWords: string[];
  inputFiles: string[];
  isPiped: boolean;
  outputFiles: string[];
}

interface Token {
  type: "word" | "redirect" | "op";
  value: string;
}

// isBare: no wrapper or env assignment was dropped from its words. outputFiles: each file a redirect writes.
export interface SimpleCommand {
  words: string[];
  isBare: boolean;
  outputFiles: string[];
}

export class ShellParser {
  readonly command: string;
  constructor(command: string) {
    this.command = command;
  }
  static init(command: string): ShellParser {
    return new ShellParser(command);
  }
  // Each simple command's words, wrappers and env assignments dropped.
  get commandWords(): string[][] {
    return this.simpleCommands
      .map(({ words }) => words)
      .filter((words) => words.length > 0);
  }
  // Keeps a bare redirect such as `> file`, which has no words but writes.
  get simpleCommands(): SimpleCommand[] {
    return this.segments
      .map(({ words, commandWords, outputFiles }) => ({
        words: commandWords,
        isBare: commandWords.length === words.length,
        outputFiles,
      }))
      .filter(
        ({ words, outputFiles }) => words.length > 0 || outputFiles.length > 0,
      );
  }
  // The simple commands of every layer of `$(…)` and backtick substitution, quoted or not, each substitution a word of its own in the layer around it; throws on one left open.
  get substitutedCommands(): SimpleCommand[] {
    return SubstitutionScanner.init(this._withoutHeredocBodies).layers.flatMap(
      (layer) => ShellParser.init(layer).simpleCommands,
    );
  }
  get segments(): Segment[] {
    const segments: Segment[] = [];
    let current = newSegment(false);
    let redirect: string | undefined;
    // A write redirect with no file after it still writes, so it keeps an empty name no path check passes.
    function endRedirect(): void {
      if (redirect?.includes(">")) current.outputFiles.push("");
      redirect = undefined;
    }
    for (const token of this._tokens) {
      if (token.type === "word") {
        if (redirect === "<") current.inputFiles.push(token.value);
        else if (!redirect) current.words.push(token.value);
        else if (
          redirect.includes(">") &&
          !isDiscardRedirect(redirect, token.value)
        ) {
          current.outputFiles.push(token.value);
        }
        redirect = undefined;
        continue;
      }
      endRedirect();
      if (token.type === "redirect") {
        redirect = token.value;
        continue;
      }
      segments.push(current);
      current = newSegment(operators.pipes.has(token.value));
    }
    endRedirect();
    segments.push(current);
    return segments.map((segment) => ({
      ...segment,
      commandWords: withoutWrappersOf(segment.words),
    }));
  }
  get _tokens(): Token[] {
    const command = this._withoutHeredocBodies;
    const tokens: Token[] = [];
    let word: string | undefined;
    function endWord(): void {
      if (word !== undefined) tokens.push({ type: "word", value: word });
      word = undefined;
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
        i = close;
      } else if (char === "\\") {
        if (next !== "\n") word = (word ?? "") + (next ?? "");
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
          value:
            operators.separators.has(value) || operators.pipes.has(value)
              ? value
              : ";",
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

function newSegment(isPiped: boolean): Segment {
  return {
    words: [],
    commandWords: [],
    inputFiles: [],
    isPiped,
    outputFiles: [],
  };
}

// A copy to a descriptor number, or /dev/null; bash opens `>&name` and `&>2` as files.
function isDiscardRedirect(redirect: string, target: string): boolean {
  if (redirect === "<>") return false;
  return (
    target === "/dev/null" || (redirect.endsWith("&") && /^\d+$/.test(target))
  );
}

function withoutWrappersOf(words: string[]): string[] {
  let start = 0;
  while (
    start < words.length &&
    (/^\w+=/.test(words[start] ?? "") || wrappers.has(words[start] ?? ""))
  ) {
    start++;
  }
  return words.slice(start);
}
