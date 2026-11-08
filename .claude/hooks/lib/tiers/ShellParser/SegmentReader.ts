// Reads mvdan/sh's syntax tree of a Bash call into the segments of its simple commands, through loops, conditionals, groups, subshells, substitutions and functions; ../ShellParser.ts parses the call and serves the segments.
// A `for` list, a `case` word and its patterns are data, though their substitutions run. A function's body is read where it's defined, and again at each later call, with the call's arguments for `$1`, `$2` ….
// What it can't read as bash would, such as a call of a function it can't expand, it still reads as best it can but marks the reading unreadable, which the gate leaves unclassified.
// Read inline, a substitution's commands come nested just before the segment holding them, as bash runs them first; read in layers, each substitution's commands are left for a reader of their own.
import type {
  BinaryCmd,
  Command,
  FuncDecl,
  Redirect,
  RedirOperator,
  Stmt,
} from "sh-syntax";

import { syntaxNodes } from "./syntaxNodes.ts";
import type { WordRenderer } from "./WordRenderer.ts";

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
// mvdan/sh's operator numbers.
const operatorCodes = {
  pipes: new Set([13, 14]),
  input: 65,
  readWrite: 66,
  copyOut: 68,
  // `>`, `>>`, `<>`, `>&`, `>|`, `>>|`, `&>`, `&>|`, `&>>` and `&>>|`.
  outputs: new Set<RedirOperator>([63, 64, 66, 68, 69, 70, 74, 75, 76, 77]),
} as const;
// The word a test, arithmetic or `let` command stands as: none is a known program, so the gate leaves it to Claude Code.
const constructWords = {
  ArithmCmd: "((",
  TestClause: "[[",
  LetClause: "let",
} as const;

// commandWords: its words with leading wrappers and env assignments dropped. isNested: inside a loop, conditional, group, subshell, substitution or function, or negated by `!`, so a later command can't count on it having run once, in this shell, and succeeded.
export interface Segment {
  words: string[];
  commandWords: string[];
  inputFiles: string[];
  isPiped: boolean;
  outputFiles: string[];
  isNested?: boolean;
}

// functionNames: each name the call defines as a function. calledNames: each command's first word, before any call is expanded. substitutions: read in layers, the commands of each substitution left for a reader of their own.
export interface SegmentReading {
  segments: Segment[];
  isReadable: boolean;
  functionNames: Set<string>;
  calledNames: Set<string>;
  substitutions: Stmt[][];
}

// isLayered: leave each substitution's commands to a reader of their own.
interface ReaderSource {
  words: WordRenderer;
  stmts: Stmt[];
  isLayered: boolean;
}

export class SegmentReader {
  readonly words: WordRenderer;
  readonly stmts: Stmt[];
  readonly isLayered: boolean;
  readonly segments: Segment[] = [];
  readonly definitions = new Map<string, Segment[]>();
  readonly calledNames = new Set<string>();
  readonly functionNames: Set<string>;
  readonly substitutions: Stmt[][] = [];
  isReadable = true;
  depth = 0;
  isPipedNext = false;
  constructor({ words, stmts, isLayered }: ReaderSource) {
    this.words = words;
    this.stmts = stmts;
    this.isLayered = isLayered;
    this.functionNames = syntaxNodes.functionNamesIn(stmts);
  }
  static init(source: ReaderSource): SegmentReader {
    return new SegmentReader(source);
  }
  // Reads the tree once; a second call would read it onto the first reading.
  read(): SegmentReading {
    this._readStmts(this.stmts);
    return {
      segments: this.segments,
      isReadable: this.isReadable,
      functionNames: this.functionNames,
      calledNames: this.calledNames,
      substitutions: this.substitutions,
    };
  }
  _readStmts(stmts: Stmt[]): void {
    stmts.forEach((stmt) => this._readStmt(stmt, []));
  }
  // prefix: words a `time` before the command adds to it.
  _readStmt(stmt: Stmt, prefix: string[]): void {
    if (stmt.negated) this.depth++;
    this._readCommand(stmt, prefix);
    if (stmt.negated) this.depth--;
  }
  _readCommand(stmt: Stmt, prefix: string[]): void {
    const { cmd, redirs } = stmt;
    const words = cmd ? this._simpleWordsOf(cmd) : [];
    if (words) {
      this._readSubstitutionsIn([cmd, redirs]);
      this._flush(this._segmentOf([...prefix, ...words], redirs));
      return;
    }
    if (cmd?.type === "TimeClause") {
      const timed = cmd.posixFormat ? ["time", "-p"] : ["time"];
      if (cmd.stmt) this._readStmt(cmd.stmt, [...prefix, ...timed]);
      else this._flush(this._segmentOf([...prefix, ...timed], []));
    } else if (cmd?.type === "BinaryCmd") this._readBinary(cmd);
    else if (cmd?.type === "FuncDecl") this._readDefinition(cmd);
    else if (cmd) this._nestedRead(() => this._readCompound(cmd));
    // A compound command's own redirects go on a segment of no words.
    if (redirs.length === 0) return;
    this._readSubstitutionsIn(redirs);
    this._flush(this._segmentOf([], redirs));
  }
  _simpleWordsOf(cmd: Command): string[] | undefined {
    if (cmd.type === "CallExpr") {
      return [
        ...cmd.assigns.map((assign) => this.words.assignOf(assign)),
        ...cmd.args.map((arg) => this.words.wordOf(arg)),
      ];
    }
    if (cmd.type === "DeclClause") {
      return [
        cmd.variant?.value ?? "",
        ...cmd.args.map((assign) => this.words.assignOf(assign)),
      ];
    }
    if (
      cmd.type === "ArithmCmd" ||
      cmd.type === "TestClause" ||
      cmd.type === "LetClause"
    ) {
      return [constructWords[cmd.type]];
    }
    return undefined;
  }
  _readBinary(cmd: BinaryCmd): void {
    if (cmd.x) this._readStmt(cmd.x, []);
    if (operatorCodes.pipes.has(cmd.op)) this.isPipedNext = true;
    if (cmd.y) this._readStmt(cmd.y, []);
  }
  // A definition's body must be a group or a subshell; mvdan/sh takes any command there, which bash doesn't.
  _readDefinition(decl: FuncDecl): void {
    const { name, body } = decl;
    const bodyType = body?.cmd?.type;
    if (!name || (bodyType !== "Block" && bodyType !== "Subshell")) {
      this.isReadable = false;
    }
    const from = this.segments.length;
    if (body) this._nestedRead(() => this._readStmt(body, []));
    if (name) this.definitions.set(name.value, this.segments.slice(from));
  }
  _readCompound(cmd: Command): void {
    if (cmd.type === "Block" || cmd.type === "Subshell") {
      this._readStmts(cmd.stmts);
    } else if (cmd.type === "IfClause") {
      this._readStmts(cmd.cond);
      this._readStmts(cmd.then);
      if (cmd.else) this._readCompound(cmd.else);
    } else if (cmd.type === "WhileClause") {
      this._readStmts(cmd.cond);
      this._readStmts(cmd.do);
    } else if (cmd.type === "ForClause") {
      this._readSubstitutionsIn(cmd.loop);
      this._readStmts(cmd.do);
    } else if (cmd.type === "CaseClause") {
      this._readSubstitutionsIn(cmd.word);
      cmd.items.forEach(({ patterns, stmts }) => {
        this._readSubstitutionsIn(patterns);
        this._readStmts(stmts);
      });
    } else {
      // A coprocess, or a test declaration bash has no such syntax for.
      this.isReadable = false;
      if (cmd.type === "CoprocClause" && cmd.stmt) this._readStmt(cmd.stmt, []);
    }
  }
  _readSubstitutionsIn(tree: unknown): void {
    const substitutions = syntaxNodes.substitutionsIn(tree);
    if (this.isLayered) {
      substitutions.forEach(({ stmts }) => this.substitutions.push(stmts));
      return;
    }
    // A pipe feeds the command holding the substitution, not the substitution.
    const { isPipedNext } = this;
    this.isPipedNext = false;
    this._nestedRead(() =>
      substitutions.forEach(({ stmts }) => this._readStmts(stmts)),
    );
    this.isPipedNext = isPipedNext;
  }
  _nestedRead(read: () => void): void {
    this.depth++;
    read();
    this.depth--;
  }
  _segmentOf(words: string[], redirects: Redirect[]): Segment {
    const segment: Segment = {
      words,
      commandWords: withoutWrappersOf(words),
      inputFiles: redirects.flatMap(({ op, word }) =>
        op === operatorCodes.input && word ? [this.words.wordOf(word)] : [],
      ),
      isPiped: this.isPipedNext,
      outputFiles: redirects.flatMap((redirect) =>
        this._outputFilesOf(redirect),
      ),
      ...(this.depth > 0 ? { isNested: true } : {}),
    };
    this.isPipedNext = false;
    return segment;
  }
  _outputFilesOf({ op, word }: Redirect): string[] {
    if (!operatorCodes.outputs.has(op)) return [];
    const file = word ? this.words.wordOf(word) : "";
    return isDiscardRedirect(op, file) ? [] : [file];
  }
  // A call of a function read so far reads its body again, with the call's own redirects kept on a segment of no words.
  _flush(segment: Segment): void {
    const [name, ...args] = segment.commandWords;
    if (name !== undefined) this.calledNames.add(name);
    const body = name === undefined ? undefined : this.definitions.get(name);
    if (!body) {
      // Bash runs a function defined later, or the one being defined, where the reader has no body to read.
      if (name !== undefined && this.functionNames.has(name)) {
        this.isReadable = false;
      }
      this.segments.push(segment);
      return;
    }
    // Bash splits an unquoted `$1` holding a space, which this reading can't tell from a quoted one.
    if (args.some((arg) => /\s/.test(arg))) this.isReadable = false;
    this.segments.push(
      { ...segment, words: [], commandWords: [] },
      ...body.map((bodySegment) => calledSegmentOf(bodySegment, args)),
    );
  }
}

// A copy to a descriptor number, or /dev/null; bash opens `>&name` and `&>2` as files.
function isDiscardRedirect(op: RedirOperator, target: string): boolean {
  if (op === operatorCodes.readWrite) return false;
  return (
    target === "/dev/null" ||
    (op === operatorCodes.copyOut && /^\d+$/.test(target))
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

// A body segment as a call runs it: `$@` or `$*` as a whole word takes every argument, and `$1` or `${1}` the first.
function calledSegmentOf(segment: Segment, args: string[]): Segment {
  const words = segment.words.flatMap((word) =>
    word === "$@" || word === "$*" ? args : [withArgumentsIn(word, args)],
  );
  return {
    words,
    commandWords: withoutWrappersOf(words),
    inputFiles: segment.inputFiles.map((file) => withArgumentsIn(file, args)),
    isPiped: segment.isPiped,
    outputFiles: segment.outputFiles.map((file) => withArgumentsIn(file, args)),
    isNested: true,
  };
}

function withArgumentsIn(word: string, args: string[]): string {
  return word.replace(
    /\$\{([1-9]\d*)\}|\$([1-9])/g,
    (_match, braced: string | undefined, bare: string | undefined) =>
      args[Number(braced ?? bare) - 1] ?? "",
  );
}

// The folders a later command may run in after a `cd` to targets: the targets alone when the `cd` surely ran and carries on, else the folders before it too.
export function foldersAfterCdOf<FD extends string | undefined>(
  folders: FD[],
  targets: FD[],
  isCarriedOn: boolean,
): FD[] {
  return [...new Set(isCarriedOn ? targets : [...folders, ...targets])];
}
