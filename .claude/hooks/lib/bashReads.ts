// Classifies a Bash command's file reads; shared by the Bash-read guard and the read-count nudge.
import { existsSync, readFileSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";

import type { HookInput } from "./hookIo.ts";
import { readSheetsConfigs } from "./sheetsConfigs.ts";

export const largeFileLines = 150;
const unguardedDirs = ["node_modules", ".git", ".probe", "dist", "coverage"];
const commandNames = {
  wrappers: new Set(["sudo", "command", "env", "time", "nice", "nohup", "exec", "builtin"]),
  wholeFile: new Set(["cat", "nl", "bat", "less", "more", "tac"]),
  headTail: new Set(["head", "tail"]),
  search: new Set(["grep", "egrep", "fgrep", "rg", "ag"]),
} as const;
const operators = {
  separators: new Set([";", "&&", "||", "&", "$(", "(", ")", "`"]),
  pipes: new Set(["|", "|&"]),
} as const;

export interface BashReadsProps {
  command: string;
  cwd: string;
  projectDir: string;
}

// projectDir defaults to cwd.
type BashReadsInit = Omit<BashReadsProps, "projectDir"> & { projectDir?: string };

export interface Classification {
  isRead: boolean;
  denyReason: string | undefined;
}

interface Segment {
  words: string[];
  inputFiles: string[];
  isPiped: boolean;
}

interface FileRead {
  kind: "whole" | "range" | "filter" | "search";
  files: string[];
  span?: number;
}

interface SegmentRead {
  name: string;
  read: FileRead;
  paths: string[];
  isPipedOn: boolean;
}

interface Token {
  type: "word" | "redirect" | "op";
  value: string;
}

export class BashReads {
  readonly command: string;
  readonly cwd: string;
  readonly projectDir: string;
  constructor({ command, cwd, projectDir }: BashReadsProps) {
    this.command = command;
    this.cwd = cwd;
    this.projectDir = projectDir;
  }
  static init({ command, cwd, projectDir }: BashReadsInit): BashReads {
    return new BashReads({ command, cwd, projectDir: projectDir ?? cwd });
  }
  static initFromHook(input: HookInput, command: string): BashReads {
    return BashReads.init({
      command,
      cwd: input.cwd ?? process.cwd(),
      projectDir: process.env.CLAUDE_PROJECT_DIR,
    });
  }
  // Throws on a command it cannot parse; callers treat that as "allow, not a read".
  classify(): Classification {
    let isRead = false;
    for (const { name, read, paths } of this._segmentReads()) {
      isRead = true;
      for (const path of paths) {
        const denyReason = this._denyReasonFor(name, read, path);
        if (denyReason) return { isRead, denyReason };
      }
    }
    return { isRead, denyReason: undefined };
  }
  // Absolute paths printed in full: a whole-file command whose output no pipe trims. Throws as classify does.
  wholeFilePaths(): string[] {
    return this._segmentReads()
      .filter(({ name, read, isPipedOn }) => commandNames.wholeFile.has(name) && read.kind === "whole" && !isPipedOn)
      .flatMap(({ paths }) => paths);
  }
  _segmentReads(): SegmentRead[] {
    let cwd = this.cwd;
    const reads: SegmentRead[] = [];
    const segments = segmentsOf(tokenize(stripHeredocBodies(this.command)));
    segments.forEach((segment, index) => {
      const [first, ...args] = commandWords(segment.words);
      if (first === undefined) return;
      const name = basename(first);
      if (name === "cd") {
        if (args[0]) cwd = resolve(cwd, expandHome(args[0]));
        return;
      }
      const read = readOf(name, args, segment);
      if (!read) return;
      const paths = [...read.files, ...segment.inputFiles].map((file) => resolve(cwd, expandHome(file)));
      reads.push({ name, read, paths, isPipedOn: segments[index + 1]?.isPiped ?? false });
    });
    return reads;
  }
  _denyReasonFor(name: string, read: FileRead, path: string): string | undefined {
    if (read.kind === "search") return undefined;
    const shown = relative(this.projectDir, path);
    if (this._columnConfigsPaths().includes(path)) {
      if (read.kind === "range" && read.span !== undefined && read.span <= largeFileLines) return undefined;
      return (
        `Bash-read guard: \`${name}\` would read columnConfigs.ts beyond one block. ` +
        `Grep it for the sheet key (e.g. \`"occupancy":\`) with -A to read that object, ` +
        `or \`sed -n 'a,bp'\` a range of at most ${largeFileLines} lines. (AGENTS.md, "Read the block, not the file".)`
      );
    }
    if (read.kind !== "whole" || !this._isGuarded(path)) return undefined;
    const lines = lineCountOf(path);
    if (lines <= largeFileLines) return undefined;
    return (
      `Bash-read guard: \`${name}\` would dump all ${lines} lines of ${shown}. ` +
      `Use Read with offset/limit on the block you need, or Grep for the symbol first; ` +
      `\`sed -n 'a,bp'\` and \`head -n ${largeFileLines}\` also work.`
    );
  }
  _columnConfigsPaths(): string[] {
    return readSheetsConfigs(this.projectDir).map(({ generatedDir }) =>
      join(this.projectDir, generatedDir, "columnConfigs.ts"),
    );
  }
  // An unguarded folder at any depth, so each package's own .probe/, dist/ and coverage/ are free to read.
  _isGuarded(path: string): boolean {
    const inside = relative(this.projectDir, path);
    if (!inside || inside.startsWith("..") || isAbsolute(inside)) return false;
    if (dirname(inside).split(sep).some((dir) => unguardedDirs.includes(dir))) return false;
    return existsSync(path) && statSync(path).isFile();
  }
}

function readOf(name: string, args: string[], segment: Segment): FileRead | undefined {
  if (commandNames.wholeFile.has(name)) return fileRead(nonFlags(args), segment, "whole");
  if (commandNames.headTail.has(name)) return headTailRead(name, args, segment);
  if (name === "sed") return sedRead(args, segment);
  if (name === "awk") return fileRead(nonFlags(args).slice(1), segment, "filter");
  const isSearch = commandNames.search.has(name) || (name === "git" && args[0] === "grep");
  if (!isSearch || (segment.isPiped && segment.inputFiles.length === 0)) return undefined;
  return { kind: "search", files: [] };
}

// Each simple command's words, wrappers and env assignments dropped; throws on an unbalanced quote.
export function commandWordsOf(command: string): string[][] {
  return segmentsOf(tokenize(stripHeredocBodies(command)))
    .map((segment) => commandWords(segment.words))
    .filter((words) => words.length > 0);
}

// A command with no file operand reads a pipe or a heredoc, which is not a file read.
function fileRead(
  files: string[],
  segment: Segment,
  kind: FileRead["kind"],
  extra: { span?: number } = {},
): FileRead | undefined {
  if (files.length === 0 && segment.inputFiles.length === 0) return undefined;
  return { kind, files, ...extra };
}

function nonFlags(args: string[]): string[] {
  return args.filter((arg) => !arg.startsWith("-") && !isGlob(arg));
}

function headTailRead(name: string, args: string[], segment: Segment): FileRead | undefined {
  let count = 10;
  let isBounded = true;
  const files: string[] = [];
  for (let i = 0; i < args.length; i++) {
    const arg = args[i] ?? "";
    const value = arg === "-n" || arg === "-c" ? args[++i] : optionValue(arg);
    if (value === undefined) {
      if (!arg.startsWith("-") && !isGlob(arg)) files.push(arg);
      continue;
    }
    // `head -n -5` is all but 5 lines and `tail -n +5` is line 5 on: both run to the file's end.
    const sign = String(value)[0];
    if ((name === "head" && sign === "-") || (name === "tail" && sign === "+")) isBounded = false;
    if (arg.startsWith("-c")) continue;
    count = Number.parseInt(String(value).replace(/^[+-]/, ""), 10);
  }
  const isSmall = isBounded && Number.isFinite(count) && count <= largeFileLines;
  return fileRead(files, segment, isSmall ? "range" : "whole", { span: count });
}

function optionValue(arg: string): string | undefined {
  const match =
    /^-n([+-]?\d+)$/.exec(arg) ?? /^--lines=([+-]?\d+)$/.exec(arg) ?? /^-(\d+)$/.exec(arg) ?? /^-c(\d+)$/.exec(arg);
  return match ? match[1] : undefined;
}

function sedRead(args: string[], segment: Segment): FileRead | undefined {
  if (args.some((arg) => /^-[a-zA-Z]*i/.test(arg) || arg.startsWith("--in-place"))) return undefined;
  const isQuiet = args.some((arg) => /^-[a-zA-Z]*n/.test(arg) || arg === "--quiet");
  const scripts: (string | undefined)[] = [];
  const rest: string[] = [];
  for (let i = 0; i < args.length; i++) {
    const arg = args[i] ?? "";
    if (arg === "-e" || arg === "-f") scripts.push(args[++i]);
    else if (!arg.startsWith("-")) rest.push(arg);
  }
  if (scripts.length === 0) scripts.push(rest.shift());
  const files = rest.filter((arg) => !isGlob(arg));
  const isToEnd = scripts.some((script) => /\d+\s*,\s*\$\s*p/.test(String(script)));
  if (!isQuiet || isToEnd) return fileRead(files, segment, "whole");
  const span = rangeSpanOf(scripts.join(";"));
  return span === undefined ? fileRead(files, segment, "filter") : fileRead(files, segment, "range", { span });
}

// `12,40p` or `12p` pieces only; anything else (a pattern, `$`) is not a numeric range.
function rangeSpanOf(script: string): number | undefined {
  let span = 0;
  for (const piece of String(script).split(/[;\n]/).map((part) => part.trim()).filter(Boolean)) {
    const match = /^(\d+)(?:,(\d+))?p$/.exec(piece);
    if (!match) return undefined;
    const start = Number(match[1]);
    const end = match[2] === undefined ? start : Number(match[2]);
    span += Math.max(0, end - start + 1);
  }
  return span;
}

function lineCountOf(path: string): number {
  const { size } = statSync(path);
  if (size > 1024 * 1024) return Number.POSITIVE_INFINITY;
  const text = readFileSync(path, "utf8");
  let lines = 0;
  for (const char of text) if (char === "\n") lines++;
  return text.endsWith("\n") || text === "" ? lines : lines + 1;
}

function commandWords(words: string[]): string[] {
  let start = 0;
  while (start < words.length && (/^\w+=/.test(words[start] ?? "") || commandNames.wrappers.has(words[start] ?? ""))) start++;
  return words.slice(start);
}

function basename(word: string): string {
  return word.slice(word.lastIndexOf("/") + 1);
}

function expandHome(path: string): string {
  return path === "~" || path.startsWith("~/") ? join(homedir(), path.slice(1)) : path;
}

function isGlob(word: string): boolean {
  return /[*?[\]{}$]/.test(word);
}

function stripHeredocBodies(command: string): string {
  const kept: string[] = [];
  const pending: string[] = [];
  for (const line of command.split("\n")) {
    if (pending.length > 0) {
      if (line.trim() === pending[0]) pending.shift();
      continue;
    }
    kept.push(line);
    for (const match of line.matchAll(/<<-?\s*(['"]?)([\w.-]+)\1/g)) pending.push(match[2] ?? "");
  }
  return kept.join("\n");
}

function segmentsOf(tokens: Token[]): Segment[] {
  const segments: Segment[] = [];
  let current = newSegment(false);
  let redirect: string | undefined;
  for (const token of tokens) {
    if (token.type === "word") {
      if (redirect === "<") current.inputFiles.push(token.value);
      else if (!redirect) current.words.push(token.value);
      redirect = undefined;
      continue;
    }
    if (token.type === "redirect") {
      redirect = token.value;
      continue;
    }
    redirect = undefined;
    segments.push(current);
    current = newSegment(operators.pipes.has(token.value));
  }
  segments.push(current);
  return segments;
}

function newSegment(isPiped: boolean): Segment {
  return { words: [], inputFiles: [], isPiped };
}

function tokenize(command: string): Token[] {
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
      const close = findClosingQuote(command, i);
      word = (word ?? "") + command.slice(i + 1, close).replace(/\\(["\\$`])/g, char === '"' ? "$1" : "\\$1");
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
    } else if (char === "<" || char === ">" || (char === "&" && next === ">")) {
      if (word !== undefined && /^\d+$/.test(word)) word = undefined;
      endWord();
      let value = char;
      while (/[<>&|]/.test(command[i + 1] ?? "") && value.length < 3) value += command.charAt(++i);
      tokens.push({ type: "redirect", value });
    } else if (char === "|" || char === "&" || char === ";" || char === "(" || char === ")" || char === "`") {
      endWord();
      const pair = char + (next ?? "");
      const value = ["||", "&&", "|&", ";;"].includes(pair) ? pair : char;
      if (value.length === 2) i++;
      tokens.push({ type: "op", value: operators.separators.has(value) || operators.pipes.has(value) ? value : ";" });
    } else {
      word = (word ?? "") + char;
    }
  }
  endWord();
  return tokens;
}

function findClosingQuote(command: string, open: number): number {
  const quote = command[open];
  for (let i = open + 1; i < command.length; i++) {
    if (quote === '"' && command[i] === "\\") i++;
    else if (command[i] === quote) return i;
  }
  throw new Error("Unbalanced quote");
}
