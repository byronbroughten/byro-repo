// Parses a Bash call with mvdan/sh's parser into its simple commands, for the tier gate, the branch guard and BashReads; throws on syntax bash rejects too, and on a parser that won't run.
// ShellParser/shellSyntax.ts loads the parser; ShellParser/SegmentReader.ts reads its tree through loops, conditionals, groups, substitutions and functions.
import type { Stmt } from "sh-syntax";

import { ParserUnavailableError } from "./ShellParser/ParserUnavailableError.ts";
import {
  type Segment,
  SegmentReader,
  type SegmentReading,
} from "./ShellParser/SegmentReader.ts";
import { shellSyntax } from "./ShellParser/shellSyntax.ts";
import { syntaxNodes } from "./ShellParser/syntaxNodes.ts";
import { WordRenderer } from "./ShellParser/WordRenderer.ts";

// isBare: no wrapper or env assignment was dropped from its words.
export interface SimpleCommand {
  words: string[];
  isBare: boolean;
}

// isQuoted: its delimiter is quoted, so bash expands nothing in its body.
export interface Heredoc {
  delimiter: string;
  isQuoted: boolean;
}

// The commands of a call the gate parses, or what it couldn't read.
interface Parsing {
  commands?: SimpleCommand[];
  failure?: string;
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
  // The simple commands of every layer of `$(…)`, backtick and process substitution, quoted or not, each substitution a word of its own in the layer around it; throws on syntax bash rejects, on compound syntax it can't read as bash would, and on a call of a function another layer defines.
  get substitutedCommands(): SimpleCommand[] {
    const readings = layerReadingsOf(this._words, this._stmts);
    readings.forEach((reading, at) => {
      if (!reading.isReadable) {
        throw new Error("compound syntax the gate can't read as bash would");
      }
      const isCallingOtherLayer = readings.some(
        (other, otherAt) =>
          otherAt !== at &&
          [...other.functionNames].some((name) =>
            reading.calledNames.has(name),
          ),
      );
      if (isCallingOtherLayer) {
        throw new Error("a function called across a substitution");
      }
    });
    return readings.flatMap(({ segments }) => simpleCommandsOf(segments));
  }
  // Undefined for a command the gate can't parse, which callers leave to another rule.
  get parsedCommands(): SimpleCommand[] | undefined {
    return this._parsing.commands;
  }
  // What the gate can't read in the call, finishing "it holds …"; undefined for one it parses. With no parser, the whole refusal.
  get parseFailure(): string | undefined {
    return this._parsing.failure;
  }
  get isParserMissing(): boolean {
    try {
      shellSyntax.treeOf(this.command);
    } catch (error) {
      return error instanceof ParserUnavailableError;
    }
    return false;
  }
  get _parsing(): Parsing {
    try {
      return { commands: this.substitutedCommands };
    } catch (error) {
      return {
        failure: error instanceof Error ? error.message : String(error),
      };
    }
  }
  // Undefined for a call the gate can't parse.
  get heredocs(): Heredoc[] | undefined {
    let stmts: Stmt[];
    try {
      stmts = this._stmts;
    } catch {
      return undefined;
    }
    const words = this._words;
    return syntaxNodes.heredocsIn(stmts).map(({ word }) => ({
      delimiter: word ? words.wordOf(word) : "",
      isQuoted: (word?.parts ?? []).some(
        (part) => part.type !== "Lit" || part.value.includes("\\"),
      ),
    }));
  }
  // No `$'…'`, and every heredoc behind a quoted delimiter, so the text a command gets is the text the call holds.
  get isPlainText(): boolean {
    return (
      !/\$'/.test(this.command) &&
      (this.heredocs?.every(({ isQuoted }) => isQuoted) ?? false)
    );
  }
  // Each operator and redirect between the words, in order, a heredoc's `<<` included.
  get operators(): string[] {
    return syntaxNodes.operatorsIn(this._stmts);
  }
  get segments(): Segment[] {
    return this.reading.segments;
  }
  get reading(): SegmentReading {
    return SegmentReader.init({
      words: this._words,
      stmts: this._stmts,
      isLayered: false,
    }).read();
  }
  get _stmts(): Stmt[] {
    return shellSyntax.treeOf(this.command).stmts;
  }
  get _words(): WordRenderer {
    return WordRenderer.init(this.command);
  }
}

// Each layer's reading, depth-first: the call's own commands, then each substitution's layers in turn.
function layerReadingsOf(words: WordRenderer, stmts: Stmt[]): SegmentReading[] {
  const reading = SegmentReader.init({ words, stmts, isLayered: true }).read();
  return [
    reading,
    ...reading.substitutions.flatMap((inner) => layerReadingsOf(words, inner)),
  ];
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
