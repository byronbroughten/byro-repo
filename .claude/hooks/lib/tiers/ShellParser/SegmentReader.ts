// Reads mvdan/sh's syntax tree of a Bash call into the segments of its simple commands, through loops, conditionals, groups, subshells, substitutions and functions; ../ShellParser.ts parses the call and serves the segments.
// A `for` list, a `case` word and its patterns are data, though their substitutions run. A function's body is read where it's defined, and again at each later call, with the call's arguments for `$1`, `$2` ….
// What it can't read as bash would, such as a call of a function it can't expand, it still reads as best it can but marks the reading unreadable, which the gate leaves unclassified.
// Read inline, a substitution's commands come nested just before the segment holding them, as bash runs them first; read in layers, each substitution's commands are left for a reader of their own.
import type {
  Command,
  FuncDecl,
  IfClause,
  Redirect,
  RedirOperator,
  Stmt,
} from "sh-syntax";

import { operatorCodes as shOperators, syntaxNodes } from "./syntaxNodes.ts";
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
const { binary, redirect } = shOperators;
const pipeOperators = new Set<number>([binary.Pipe, binary.PipeAll]);
const outputOperators = new Set<RedirOperator>([
  redirect.RdrOut,
  redirect.AppOut,
  redirect.RdrInOut,
  redirect.DplOut,
  redirect.ClbOut,
  redirect.AppClob,
  redirect.RdrAll,
  redirect.RdrAllClob,
  redirect.AppAll,
  redirect.AppAllClob,
]);

type CommandOf<CT extends Command["type"]> = Extract<Command, { type: CT }>;
// How each kind of command is read: a simple one's words go on one segment with its redirects; any other kind is read through, and its own redirects go on a segment of no words after it.
type CommandReaders = {
  [CT in Command["type"]]: (
    reader: SegmentReader,
    cmd: CommandOf<CT>,
    stmt: Stmt,
    prefix: string[],
  ) => void;
};

// A test, arithmetic or `let` command stands as the word "[[", "((" or "let": none is a known program, so the gate leaves it to Claude Code.
const commandReaders: CommandReaders = {
  CallExpr(reader, cmd, stmt, prefix) {
    reader._readSimple(stmt, [
      ...prefix,
      ...cmd.assigns.map((assign) => reader.words.assignOf(assign)),
      ...cmd.args.map((arg) => reader.words.wordOf(arg)),
    ]);
  },
  DeclClause(reader, cmd, stmt, prefix) {
    reader._readSimple(stmt, [
      ...prefix,
      cmd.variant?.value ?? "",
      ...cmd.args.map((assign) => reader.words.assignOf(assign)),
    ]);
  },
  ArithmCmd(reader, _cmd, stmt, prefix) {
    reader._readSimple(stmt, [...prefix, "(("]);
  },
  TestClause(reader, _cmd, stmt, prefix) {
    reader._readSimple(stmt, [...prefix, "[["]);
  },
  LetClause(reader, _cmd, stmt, prefix) {
    reader._readSimple(stmt, [...prefix, "let"]);
  },
  TimeClause(reader, cmd, stmt, prefix) {
    const timed = [...prefix, ...(cmd.posixFormat ? ["time", "-p"] : ["time"])];
    reader._readThrough(stmt, () => {
      if (cmd.stmt) reader._readStmt(cmd.stmt, timed);
      else reader._flush(reader._segmentOf(timed, []));
    });
  },
  BinaryCmd(reader, cmd, stmt) {
    reader._readThrough(stmt, () => {
      if (cmd.x) reader._readStmt(cmd.x, []);
      if (pipeOperators.has(cmd.op)) reader.isPipedNext = true;
      if (cmd.y) reader._readStmt(cmd.y, []);
    });
  },
  FuncDecl(reader, cmd, stmt) {
    reader._readThrough(stmt, () => reader._readDefinition(cmd));
  },
  Block(reader, cmd, stmt) {
    reader._readNestedThrough(stmt, () => reader._readStmts(cmd.stmts));
  },
  Subshell(reader, cmd, stmt) {
    reader._readNestedThrough(stmt, () => reader._readStmts(cmd.stmts));
  },
  IfClause(reader, cmd, stmt) {
    reader._readNestedThrough(stmt, () => reader._readIf(cmd));
  },
  WhileClause(reader, cmd, stmt) {
    reader._readNestedThrough(stmt, () => {
      reader._readStmts(cmd.cond);
      reader._readStmts(cmd.do);
    });
  },
  ForClause(reader, cmd, stmt) {
    reader._readNestedThrough(stmt, () => {
      reader._readSubstitutionsIn(cmd.loop);
      reader._readStmts(cmd.do);
    });
  },
  CaseClause(reader, cmd, stmt) {
    reader._readNestedThrough(stmt, () => {
      reader._readSubstitutionsIn(cmd.word);
      cmd.items.forEach(({ patterns, stmts }) => {
        reader._readSubstitutionsIn(patterns);
        reader._readStmts(stmts);
      });
    });
  },
  CoprocClause(reader, cmd, stmt) {
    reader.isReadable = false;
    reader._readNestedThrough(stmt, () => {
      if (cmd.stmt) reader._readStmt(cmd.stmt, []);
    });
  },
  // A test declaration, which bash has no syntax for.
  TestDecl(reader, _cmd, stmt) {
    reader.isReadable = false;
    reader._readThrough(stmt, () => undefined);
  },
};

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

// readInLayers: leave each substitution's commands to a reader of their own.
interface ReaderSource {
  words: WordRenderer;
  stmts: Stmt[];
  readInLayers?: boolean;
}

export class SegmentReader {
  readonly words: WordRenderer;
  readonly stmts: Stmt[];
  readonly readsInLayers: boolean;
  readonly segments: Segment[] = [];
  readonly definitions = new Map<string, Segment[]>();
  readonly calledNames = new Set<string>();
  readonly functionNames: Set<string>;
  readonly substitutions: Stmt[][] = [];
  isReadable = true;
  depth = 0;
  isPipedNext = false;
  constructor({ words, stmts, readInLayers = false }: ReaderSource) {
    this.words = words;
    this.stmts = stmts;
    this.readsInLayers = readInLayers;
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
  // A bare redirect such as `> file` has no command, and stands as a simple one of no words of its own.
  _readCommand(stmt: Stmt, prefix: string[]): void {
    const { cmd } = stmt;
    if (!cmd) {
      this._readSimple(stmt, prefix);
      return;
    }
    readCommandOf(this, cmd, stmt, prefix);
  }
  _readSimple(stmt: Stmt, words: string[]): void {
    this._readSubstitutionsIn([stmt.cmd, stmt.redirs]);
    this._flush(this._segmentOf(words, stmt.redirs));
  }
  _readNestedThrough(stmt: Stmt, read: () => void): void {
    this._readThrough(stmt, () => this._nestedRead(read));
  }
  _readThrough({ redirs }: Stmt, read: () => void): void {
    read();
    if (redirs.length === 0) return;
    this._readSubstitutionsIn(redirs);
    this._flush(this._segmentOf([], redirs));
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
  _readIf(cmd: IfClause): void {
    this._readStmts(cmd.cond);
    this._readStmts(cmd.then);
    if (cmd.else) this._readIf(cmd.else);
  }
  _readSubstitutionsIn(tree: unknown): void {
    const substitutions = syntaxNodes.substitutionsIn(tree);
    if (this.readsInLayers) {
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
        op === redirect.RdrIn && word ? [this.words.wordOf(word)] : [],
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
    if (!outputOperators.has(op)) return [];
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

// TypeScript can't tie a command's own type to its reader's, so the reader is cast to the one its type keys.
function readCommandOf<CT extends Command["type"]>(
  reader: SegmentReader,
  cmd: CommandOf<CT>,
  stmt: Stmt,
  prefix: string[],
): void {
  const read = commandReaders[cmd.type as CT];
  read(reader, cmd, stmt, prefix);
}

// A copy to a descriptor number, or /dev/null; bash opens `>&name` and `&>2` as files.
function isDiscardRedirect(op: RedirOperator, target: string): boolean {
  if (op === redirect.RdrInOut) return false;
  return (
    target === "/dev/null" || (op === redirect.DplOut && /^\d+$/.test(target))
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
