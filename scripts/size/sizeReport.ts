// `npm run size`'s core: each named file's characters, lines and estimated tokens, largest first, then their total.
// The entry, size.ts, gathers the non-ignored file list from git and prints this report.
import { readFileSync, statSync } from "node:fs";
import { extname, join, matchesGlob, normalize } from "node:path";

// The median characters a token per read, by docs/agents/codebase-priorities/estimates.md's Reads line (byro-repo#409).
export const charactersPerToken = { code: 2.0, prose: 2.6 } as const;

const proseExtensions = [".md", ".txt"];

const totalFlag = "--total";

export interface SizeInputs {
  root: string;
  files: string[];
  args: string[];
}

interface FileSize {
  path: string;
  characters: number;
  lines: number;
  tokens: number;
}

export function sizeReportOf({ root, files, args }: SizeInputs): string {
  const isTotalOnly = args.includes(totalFlag);
  const patterns = args.filter((arg) => arg !== totalFlag);
  const unknownFlag = patterns.find((pattern) => pattern.startsWith("--"));
  if (unknownFlag !== undefined) throw new Error(`unknown flag ${unknownFlag}`);
  if (patterns.length === 0) throw new Error("no file named");
  const paths = new Set(
    patterns.flatMap((pattern) => {
      const matches = matchesOf(root, files, pattern);
      if (matches.length === 0) throw new Error(`${pattern} matches no file`);
      return matches;
    }),
  );
  const sizes = [...paths]
    .map((path) => sizeOf(root, path))
    .sort((a, b) => b.tokens - a.tokens || a.path.localeCompare(b.path));
  const total = rowOf(totalOf(sizes));
  if (isTotalOnly) return `${total.join("  ")}\n`;
  const rows = [["file", "characters", "lines", "tokens"], ...sizes.map(rowOf)];
  return `${paddedLinesOf([...rows, total]).join("\n")}\n`;
}

// A named file counts even when gitignored; a directory or glob takes only the non-ignored list's files.
function matchesOf(root: string, files: string[], pattern: string): string[] {
  const path = normalize(pattern).replace(/\/+$/, "");
  const stats = statSync(join(root, path), { throwIfNoEntry: false });
  if (stats?.isFile()) return [path];
  const onDisk = files.filter((file) => isFileOnDisk(join(root, file)));
  if (stats?.isDirectory()) {
    if (path === ".") return onDisk;
    return onDisk.filter((file) => file.startsWith(`${path}/`));
  }
  return onDisk.filter((file) => matchesGlob(file, path));
}

function isFileOnDisk(path: string): boolean {
  return statSync(path, { throwIfNoEntry: false })?.isFile() ?? false;
}

function sizeOf(root: string, path: string): FileSize {
  const text = readFileSync(join(root, path), "utf8");
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

function rowOf({ path, characters, lines, tokens }: FileSize): string[] {
  return [
    path,
    String(characters),
    String(lines),
    `~${(tokens / 1000).toFixed(1)}K`,
  ];
}

function paddedLinesOf(rows: string[][]): string[] {
  const widths = rows[0]?.map((_, column) =>
    Math.max(...rows.map((row) => row[column]?.length ?? 0)),
  );
  return rows.map((row) =>
    row
      .map((cell, column) => cell.padEnd(widths?.[column] ?? 0))
      .join("  ")
      .trimEnd(),
  );
}
