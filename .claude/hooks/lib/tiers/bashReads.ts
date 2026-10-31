// Classifies a Bash command's file reads; shared by the Bash-read guard and the read-count nudge.
import { existsSync, readFileSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";

import type { HookInput } from "../hookIo.ts";
import { rootRelative } from "../lintSet.ts";
import { readSheetsConfigs } from "../sheetsConfigs.ts";
import { commandWordsOf, type Segment, ShellParser } from "./ShellParser.ts";
import { sedCallOf } from "./stdoutFilters.ts";

export const largeFileLines = 150;
const unguardedDirs = ["node_modules", ".git", ".probe", "dist", "coverage"];
const commandNames = {
  wholeFile: new Set(["cat", "nl", "bat", "less", "more", "tac"]),
  headTail: new Set(["head", "tail"]),
  search: new Set(["grep", "egrep", "fgrep", "rg", "ag"]),
} as const;

export interface BashReadsProps {
  command: string;
  cwd: string;
  projectDir: string;
}

// projectDir defaults to cwd.
type BashReadsInit = Omit<BashReadsProps, "projectDir"> & {
  projectDir?: string;
};

export interface Classification {
  isRead: boolean;
  denyReason: string | undefined;
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
      .filter(
        ({ name, read, isPipedOn }) =>
          commandNames.wholeFile.has(name) &&
          read.kind === "whole" &&
          !isPipedOn,
      )
      .flatMap(({ paths }) => paths);
  }
  _segmentReads(): SegmentRead[] {
    let cwd = this.cwd;
    const reads: SegmentRead[] = [];
    const { segments } = ShellParser.init(this.command);
    segments.forEach((segment, index) => {
      const [first, ...args] = commandWordsOf(segment.words);
      if (first === undefined) return;
      const name = basename(first);
      if (name === "cd") {
        if (args[0]) cwd = resolve(cwd, expandHome(args[0]));
        return;
      }
      const read = readOf(name, args, segment);
      if (!read) return;
      const paths = [...read.files, ...segment.inputFiles].map((file) =>
        resolve(cwd, expandHome(file)),
      );
      reads.push({
        name,
        read,
        paths,
        isPipedOn: segments[index + 1]?.isPiped ?? false,
      });
    });
    return reads;
  }
  _denyReasonFor(
    name: string,
    read: FileRead,
    path: string,
  ): string | undefined {
    if (read.kind === "search") return undefined;
    const shown = relative(this.projectDir, path);
    if (this._isColumnConfigs(path)) {
      if (
        read.kind === "range" &&
        read.span !== undefined &&
        read.span <= largeFileLines
      ) {
        return undefined;
      }
      return (
        `Bash-read guard: \`${name}\` would read columnConfigs.ts beyond one block. ` +
        `Grep it for the Table key (e.g. \`"occupancy":\`) with -A to read that object, ` +
        `or \`sed -n 'a,bp'\` a range of at most ${largeFileLines} lines. (AGENTS.md, "Read the block, not the file".)`
      );
    }
    if (read.kind !== "whole" || !this._isGuarded(path)) return undefined;
    const lines = lineCountOf(path);
    if (lines <= largeFileLines) return undefined;
    return (
      `Bash-read guard: \`${name}\` would dump all ${lines} lines of ${shown}. ` +
      `Find the block with \`grep -n\`, then print it with \`sed -n 'a,bp'\` or Read with offset/limit. ` +
      `If you need the whole file, Read it in full instead.`
    );
  }
  // Matched relative to its own root, so a workspace's copy counts as the primary's does.
  _isColumnConfigs(path: string): boolean {
    const target = rootRelative({
      projectDir: this.projectDir,
      cwd: this.projectDir,
      filePath: path,
    });
    return readSheetsConfigs(this.projectDir).some(
      ({ generatedDir }) => target === join(generatedDir, "columnConfigs.ts"),
    );
  }
  // An unguarded folder at any depth, so each package's own .probe/, dist/ and coverage/ are free to read.
  _isGuarded(path: string): boolean {
    const inside = relative(this.projectDir, path);
    if (!inside || inside.startsWith("..") || isAbsolute(inside)) return false;
    if (
      dirname(inside)
        .split(sep)
        .some((dir) => unguardedDirs.includes(dir))
    ) {
      return false;
    }
    return existsSync(path) && statSync(path).isFile();
  }
}

function readOf(
  name: string,
  args: string[],
  segment: Segment,
): FileRead | undefined {
  if (commandNames.wholeFile.has(name)) {
    return fileRead(nonFlags(args), segment, "whole");
  }
  if (commandNames.headTail.has(name)) return headTailRead(name, args, segment);
  if (name === "sed") return sedRead(args, segment);
  if (name === "awk") {
    return fileRead(nonFlags(args).slice(1), segment, "filter");
  }
  const isSearch =
    commandNames.search.has(name) || (name === "git" && args[0] === "grep");
  if (!isSearch || (segment.isPiped && segment.inputFiles.length === 0)) {
    return undefined;
  }
  return { kind: "search", files: [] };
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

function headTailRead(
  name: string,
  args: string[],
  segment: Segment,
): FileRead | undefined {
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
    if (
      (name === "head" && sign === "-") ||
      (name === "tail" && sign === "+")
    ) {
      isBounded = false;
    }
    if (arg.startsWith("-c")) continue;
    count = Number.parseInt(String(value).replace(/^[+-]/, ""), 10);
  }
  const isSmall =
    isBounded && Number.isFinite(count) && count <= largeFileLines;
  return fileRead(files, segment, isSmall ? "range" : "whole", { span: count });
}

function optionValue(arg: string): string | undefined {
  const match =
    /^-n([+-]?\d+)$/.exec(arg) ??
    /^--lines=([+-]?\d+)$/.exec(arg) ??
    /^-(\d+)$/.exec(arg) ??
    /^-c(\d+)$/.exec(arg);
  return match ? match[1] : undefined;
}

function sedRead(args: string[], segment: Segment): FileRead | undefined {
  const call = sedCallOf(args);
  if (!call || call.isInPlace) return undefined;
  const isQuiet = args.some(
    (arg) => /^-[a-zA-Z]*n/.test(arg) || arg === "--quiet",
  );
  const { scripts } = call;
  const files = call.files.filter((arg) => !isGlob(arg));
  const isToEnd = scripts.some((script) => /\d+\s*,\s*\$\s*p/.test(script));
  if (!isQuiet || isToEnd) return fileRead(files, segment, "whole");
  const span = rangeSpanOf(scripts.join(";"));
  return span === undefined
    ? fileRead(files, segment, "filter")
    : fileRead(files, segment, "range", { span });
}

// `12,40p` or `12p` pieces only; anything else (a pattern, `$`) is not a numeric range.
function rangeSpanOf(script: string): number | undefined {
  let span = 0;
  for (const piece of String(script)
    .split(/[;\n]/)
    .map((part) => part.trim())
    .filter(Boolean)) {
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

function basename(word: string): string {
  return word.slice(word.lastIndexOf("/") + 1);
}

function expandHome(path: string): string {
  return path === "~" || path.startsWith("~/")
    ? join(homedir(), path.slice(1))
    : path;
}

function isGlob(word: string): boolean {
  return /[*?[\]{}$]/.test(word);
}
