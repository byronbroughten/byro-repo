// Reads a Bash call's tokens into the segments of its simple commands, through loops, conditionals, groups, subshells and functions; ShellParser.ts tokenizes the call and serves the segments.
// A reserved word gives no command of its own, and a `for` list, a `case` word and its patterns are data. A function's body is read where it's defined, and again at each later call, with the call's arguments for `$1`, `$2` ….
// What it can't read as bash would, such as a closer with no opener or a call of a function it can't expand, it still reads as best it can but marks the reading unreadable, which the gate leaves unclassified.
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
const reservedWords = {
  openers: new Map<string, Frame>([
    ["{", "{"],
    ["if", "if"],
    ["while", "loop"],
    ["until", "loop"],
    ["for", "loop"],
    ["select", "loop"],
    ["case", "case"],
  ]),
  closers: new Map<string, Frame>([
    ["}", "{"],
    ["fi", "if"],
    ["done", "loop"],
    ["esac", "case"],
  ]),
  // Each leaves the word after it in command position.
  joiners: new Set(["then", "elif", "else", "do", "!", "function"]),
  // Each names a loop variable, then after `in` a list of data words that ends at the next operator.
  listHeads: new Set(["for", "select"]),
} as const;
export const pipes = new Set(["|", "|&"]);
const listModes = new Set<Mode>(["listName", "listIn", "listHead"]);
// The operators a case pattern holds: a newline before it, its leading `(` and the `|` between alternatives.
const patternOperators = new Set([";", "(", "|"]);

// isQuoted: a quote or backslash in a word, which keeps bash from reading it as a reserved word.
export interface Token {
  type: "word" | "redirect" | "op";
  value: string;
  isQuoted?: boolean;
}

// commandWords: its words with leading wrappers and env assignments dropped. isNested: inside a loop, conditional, group, subshell, substitution or function, or negated by `!`, so a later command can't count on it having run once, in this shell, and succeeded.
export interface Segment {
  words: string[];
  commandWords: string[];
  inputFiles: string[];
  isPiped: boolean;
  outputFiles: string[];
  isNested?: boolean;
}

// functionNames: each name the call may define as a function. calledNames: each command's first word, before any call is expanded.
export interface SegmentReading {
  segments: Segment[];
  isReadable: boolean;
  functionNames: Set<string>;
  calledNames: Set<string>;
}

// A `(` frame stands for a subshell or a `$(`, as `)` closes either.
type Frame = "{" | "(" | "if" | "loop" | "case";

type Mode =
  "command" | "listName" | "listIn" | "listHead" | "caseHead" | "casePattern";

// A function body being read: its name, the frame depth its opener reached, and the first segment it holds.
interface Body {
  name: string;
  depth: number;
  from: number;
}

export class SegmentReader {
  readonly tokens: Token[];
  readonly segments: Segment[] = [];
  readonly frames: Frame[] = [];
  readonly bodies: Body[] = [];
  readonly definitions = new Map<string, Segment[]>();
  readonly calledNames = new Set<string>();
  readonly functionNames: Set<string>;
  // The data mode each open `$(` in a `for` list or `case` word returns to, and the frame depth it opened.
  readonly dataModes: { depth: number; mode: Mode }[] = [];
  isReadable = true;
  current = newSegment(false);
  redirect: string | undefined;
  mode: Mode = "command";
  // The name a definition gave before its body's opener.
  pendingName: string | undefined;
  hasPatternWord = false;
  isNegated = false;
  at = 0;
  constructor(tokens: Token[]) {
    this.tokens = tokens;
    this.functionNames = functionNamesOf(tokens);
  }
  static init(tokens: Token[]): SegmentReader {
    return new SegmentReader(tokens);
  }
  // Reads the tokens once; a second call would read them onto the first reading.
  read(): SegmentReading {
    for (; this.at < this.tokens.length; this.at++) {
      const token = this.tokens[this.at];
      if (!token || this._readsPatternToken(token)) continue;
      if (token.type === "word") {
        this._readWord(token);
        continue;
      }
      this._endRedirect();
      if (token.type === "redirect") this.redirect = token.value;
      else this._readOperator(token.value);
    }
    this._endRedirect();
    this._flush(false);
    const isClosed =
      this.frames.length === 0 &&
      this.mode === "command" &&
      this.pendingName === undefined;
    return {
      segments: this.segments,
      isReadable: this.isReadable && isClosed,
      functionNames: this.functionNames,
      calledNames: this.calledNames,
    };
  }
  // A case pattern's words and operators are data, up to the `)` that starts its commands; an `esac` in its place ends the case.
  _readsPatternToken(token: Token): boolean {
    if (this.mode !== "casePattern") return false;
    if (token.type === "word") {
      if (!this.hasPatternWord && isReserved(token, "esac")) {
        this.mode = "command";
        this._close("case");
      }
      this.hasPatternWord = true;
      return true;
    }
    if (token.type === "op" && patternOperators.has(token.value)) return true;
    this.mode = "command";
    if (token.type === "op" && token.value === ")" && this.hasPatternWord) {
      return true;
    }
    this.isReadable = false;
    return false;
  }
  _readWord(token: Token): void {
    if (this.redirect !== undefined) {
      this._readRedirectTarget(token.value);
      return;
    }
    if (this.mode === "listName") {
      this.mode = "listIn";
      return;
    }
    if (this.mode === "listIn") {
      this._readListIn(token);
      return;
    }
    if (this.mode === "listHead") return;
    if (this.mode === "caseHead") {
      if (isReserved(token, "in")) this._startPatterns();
      return;
    }
    if (this.current.words.length === 0 && !token.isQuoted) {
      if (this._readsReservedWord(token.value)) return;
    }
    if (this.pendingName !== undefined) this._dropPendingName();
    this.current.words.push(token.value);
  }
  _readRedirectTarget(file: string): void {
    const { redirect } = this;
    this.redirect = undefined;
    if (redirect === "<") this.current.inputFiles.push(file);
    else if (redirect?.includes(">") && !isDiscardRedirect(redirect, file)) {
      this.current.outputFiles.push(file);
    }
  }
  // With no `in` after its name, a loop runs over the arguments and `do` starts its body.
  _readListIn(token: Token): void {
    this.mode = "command";
    if (isReserved(token, "in")) {
      this.mode = "listHead";
      return;
    }
    if (!isReserved(token, "do")) this.isReadable = false;
    this._readWord(token);
  }
  // A write redirect with no file after it still writes, so it keeps an empty name no path check passes.
  _endRedirect(): void {
    if (this.redirect?.includes(">")) this.current.outputFiles.push("");
    this.redirect = undefined;
  }
  _readsReservedWord(word: string): boolean {
    const opened = reservedWords.openers.get(word);
    const closed = reservedWords.closers.get(word);
    if (!opened && !closed && !reservedWords.joiners.has(word)) return false;
    if (this.pendingName !== undefined && word !== "{") this._dropPendingName();
    if (word === "function") {
      this._readFunctionKeyword();
      return true;
    }
    if (opened) this._open(opened);
    if (closed) this._close(closed);
    if (reservedWords.listHeads.has(word)) this.mode = "listName";
    if (word === "case") this.mode = "caseHead";
    if (word === "!") this.isNegated = true;
    return true;
  }
  // `function name` names a definition whose `()` is optional.
  _readFunctionKeyword(): void {
    const name = this.tokens[this.at + 1];
    if (name?.type !== "word") {
      this.isReadable = false;
      return;
    }
    this.pendingName = name.value;
    this.at++;
  }
  _readOperator(op: string): void {
    if (op === "$(" && this.mode !== "command") {
      this._readDataSubstitution();
      return;
    }
    if (this.mode === "caseHead") {
      if (op === ";") return;
      this.isReadable = false;
      this.mode = "command";
    }
    if (op === "(" && this._readsFunctionParens()) return;
    if (this.pendingName !== undefined && op !== ";" && op !== "(") {
      this._dropPendingName();
    }
    this._flush(pipes.has(op));
    if (this.mode === "listName") this.isReadable = false;
    if (listModes.has(this.mode)) this.mode = "command";
    if (op === "(" || op === "$(") this._open("(");
    else if (op === ")") this._closeParens();
    else if (op === ";;") this._endCaseItem();
  }
  // A `$(…)` in a `for` list or a `case` word runs its commands, and the data words go on after it.
  _readDataSubstitution(): void {
    this.dataModes.push({ depth: this.frames.length + 1, mode: this.mode });
    this.mode = "command";
    this._open("(");
  }
  _closeParens(): void {
    const depth = this.frames.length;
    this._close("(");
    const dataMode = this.dataModes.at(-1);
    if (dataMode?.depth !== depth) return;
    this.dataModes.pop();
    this.mode = dataMode.mode;
  }
  // `name ()` defines a function; so does `function name ()`.
  _readsFunctionParens(): boolean {
    const next = this.tokens[this.at + 1];
    if (next?.type !== "op" || next.value !== ")") return false;
    const { words, inputFiles, outputFiles } = this.current;
    const hasRedirect = inputFiles.length > 0 || outputFiles.length > 0;
    if (this.pendingName !== undefined && words.length === 0) {
      this.at++;
      return true;
    }
    const [name] = words;
    if (name === undefined || words.length > 1 || hasRedirect) return false;
    this.pendingName = name;
    this.current = newSegment(false);
    this.at++;
    return true;
  }
  _endCaseItem(): void {
    if (this.frames.at(-1) === "case") this._startPatterns();
    else this.isReadable = false;
  }
  _startPatterns(): void {
    this.mode = "casePattern";
    this.hasPatternWord = false;
  }
  // A definition's body must be a group or a subshell.
  _dropPendingName(): void {
    this.isReadable = false;
    this.pendingName = undefined;
  }
  _open(frame: Frame): void {
    this.frames.push(frame);
    if (this.pendingName === undefined) return;
    this.bodies.push({
      name: this.pendingName,
      depth: this.frames.length,
      from: this.segments.length,
    });
    this.pendingName = undefined;
  }
  _close(frame: Frame): void {
    const depth = this.frames.length;
    if (this.frames.at(-1) !== frame) {
      this.isReadable = false;
      return;
    }
    this.frames.pop();
    const body = this.bodies.at(-1);
    if (body?.depth !== depth) return;
    this.bodies.pop();
    this.definitions.set(body.name, this.segments.slice(body.from));
  }
  // A call of a function read so far reads its body again, with the call's own redirects kept on a segment of no words.
  _flush(isPipedNext: boolean): void {
    const segment: Segment = {
      ...this.current,
      commandWords: withoutWrappersOf(this.current.words),
      ...(this.frames.length > 0 || this.isNegated ? { isNested: true } : {}),
    };
    this.current = newSegment(isPipedNext);
    this.isNegated = false;
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

function newSegment(isPiped: boolean): Segment {
  return {
    words: [],
    commandWords: [],
    inputFiles: [],
    isPiped,
    outputFiles: [],
  };
}

// Every word a `name ()` or `function name` could define; reading too many only leaves more calls unreadable.
function functionNamesOf(tokens: Token[]): Set<string> {
  return new Set(
    tokens.flatMap((token, at) => {
      const next = tokens[at + 1];
      const after = tokens[at + 2];
      if (token.type !== "word") return [];
      if (isReserved(token, "function") && next?.type === "word") {
        return [next.value];
      }
      const hasParens =
        next?.type === "op" &&
        next.value === "(" &&
        after?.type === "op" &&
        after.value === ")";
      return hasParens ? [token.value] : [];
    }),
  );
}

function isReserved(token: Token, word: string): boolean {
  return token.type === "word" && !token.isQuoted && token.value === word;
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
