// `npm run size`'s core: each named file's characters, lines and estimated tokens, largest first, then their total.
// The entry, size.ts, parses the arguments, gathers the non-ignored file list from git and prints one of these reports.
import { readFileSync, statSync } from "node:fs";
import {
  extname,
  isAbsolute,
  join,
  matchesGlob,
  normalize,
  relative,
  resolve,
} from "node:path";

import { paddedLinesOf } from "../table/paddedLines.ts";

// The median characters a token per read, by docs/agents/codebase-priorities/estimates.md's Reads line (byro-repo#409).
const charactersPerToken = { code: 2.0, prose: 2.6 } as const;

const proseExtensions = [".md", ".txt"];

export interface SizeInputs {
  root: string;
  files: string[];
  patterns: string[];
}

interface FileSize {
  path: string;
  characters: number;
  lines: number;
  tokens: number;
}

export function sizeTableOf(inputs: SizeInputs): string {
  const sizes = sizesOf(inputs);
  const rows = [
    ["file", "characters", "lines", "tokens"],
    ...[...sizes, totalOf(sizes)].map(({ path, characters, lines, tokens }) => [
      path,
      String(characters),
      String(lines),
      tokensTextOf(tokens),
    ]),
  ];
  return `${paddedLinesOf(rows).join("\n")}\n`;
}

export function sizeTotalOf(inputs: SizeInputs): string {
  const { path, characters, lines, tokens } = totalOf(sizesOf(inputs));
  return `${path}: ${characters} characters, ${lines} lines, ${tokensTextOf(tokens)} tokens\n`;
}

function sizesOf({ root, files, patterns }: SizeInputs): FileSize[] {
  const paths = new Set(
    patterns.flatMap((pattern) => {
      const matches = matchesOf(root, files, pattern);
      if (matches.length === 0) throw new Error(`${pattern} matches no file`);
      return matches;
    }),
  );
  return [...paths]
    .map((path) => sizeOf(root, path))
    .sort((a, b) => b.tokens - a.tokens || a.path.localeCompare(b.path));
}

// A named file counts even when gitignored; a directory or glob takes only the non-ignored list's files.
function matchesOf(root: string, files: string[], pattern: string): string[] {
  const path = displayPathOf(root, normalize(pattern).replace(/\/+$/, ""));
  const stats = statSync(resolve(root, path), { throwIfNoEntry: false });
  if (stats?.isFile()) return [path];
  const onDisk = files.filter((file) => isFileOnDisk(join(root, file)));
  if (stats?.isDirectory()) {
    if (path === "") return onDisk;
    return onDisk.filter((file) => file.startsWith(`${path}/`));
  }
  return onDisk.filter((file) => matchesGlob(file, path));
}

// An absolute path under the root shows, and matches the non-ignored list, as relative to it.
function displayPathOf(root: string, path: string): string {
  if (!isAbsolute(path)) return path === "." ? "" : path;
  const fromRoot = relative(root, path);
  if (fromRoot.startsWith("..") || isAbsolute(fromRoot)) return path;
  return fromRoot;
}

function isFileOnDisk(path: string): boolean {
  return statSync(path, { throwIfNoEntry: false })?.isFile() ?? false;
}

function sizeOf(root: string, path: string): FileSize {
  const text = readFileSync(resolve(root, path), "utf8");
  const rate = proseExtensions.includes(extname(path))
    ? charactersPerToken.prose
    : charactersPerToken.code;
  return {
    path,
    characters: text.length,
    lines: lineCountOf(text),
    tokens: text.length / rate,
  };
}

function lineCountOf(text: string): number {
  const newlines = text.split("\n").length - 1;
  if (text === "" || text.endsWith("\n")) return newlines;
  return newlines + 1;
}

function totalOf(sizes: FileSize[]): FileSize {
  return sizes.reduce<FileSize>(
    (total, size) => {
      total.characters += size.characters;
      total.lines += size.lines;
      total.tokens += size.tokens;
      return total;
    },
    {
      path: `total (${sizes.length} ${sizes.length === 1 ? "file" : "files"})`,
      characters: 0,
      lines: 0,
      tokens: 0,
    },
  );
}

function tokensTextOf(tokens: number): string {
  return `~${(tokens / 1000).toFixed(1)}K`;
}
