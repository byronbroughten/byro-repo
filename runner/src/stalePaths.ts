// The stale-path check: each packages/<dir> mention in tracked text, test files aside, whose folder holds no clone.
import { execFile } from "node:child_process";
import { join } from "node:path";
import { promisify } from "node:util";

import { git, lines } from "./git.ts";

const execFileAsync = promisify(execFile);

// Not inside a longer name, and a trailing dot ends a sentence, not the folder.
const mentionRegex = /(?<![\w-])packages\/([\w.-]*[\w-])/g;

export interface StalePath {
  repo: string;
  file: string;
  line: number;
  path: string;
}

export interface BranchOfRepo {
  repo: string;
  branch: string;
}

export async function stalePathsOf(
  primaryRoot: string,
  clonePaths: Record<string, string>,
): Promise<StalePath[]> {
  const found: StalePath[] = [];
  for (const [repo, clonePath] of Object.entries(clonePaths)) {
    const output = await grepOf(join(primaryRoot, clonePath), []);
    found.push(...stalePathsIn(repo, output, clonePaths));
  }
  return found;
}

// Read at each branch's tip, so the worktree's state doesn't matter; a deleted file names nothing.
export async function stalePathsTouchedBy(
  primaryRoot: string,
  clonePaths: Record<string, string>,
  branches: BranchOfRepo[],
): Promise<StalePath[]> {
  const found: StalePath[] = [];
  for (const { repo, branch } of branches) {
    const folder = join(primaryRoot, clonePaths[repo] as string);
    const files = lines(
      await git(
        folder,
        "diff",
        "--name-only",
        "--diff-filter=d",
        "--no-renames",
        `master...${branch}`,
      ),
    );
    if (files.length === 0) continue;
    const output = await grepOf(folder, [branch, "--", ...files]);
    found.push(...stalePathsIn(repo, output, clonePaths, `${branch}:`));
  }
  return found;
}

export function stalePathLabelOf({
  repo,
  file,
  line,
  path,
}: StalePath): string {
  return `${repo} ${file}:${line} names ${path}, which holds no clone`;
}

// Only a prefilter for the lines mentionRegex reads; git grep exits 1 when nothing matches.
async function grepOf(folder: string, args: string[]): Promise<string> {
  try {
    const { stdout } = await execFileAsync(
      "git",
      ["grep", "-I", "-n", "-z", "--no-color", "-F", "packages/", ...args],
      { cwd: folder, maxBuffer: 64 * 1024 * 1024 },
    );
    return stdout;
  } catch (error) {
    if ((error as { code?: unknown }).code === 1) return "";
    throw error;
  }
}

function stalePathsIn(
  repo: string,
  output: string,
  clonePaths: Record<string, string>,
  refPrefix = "",
): StalePath[] {
  const cloneFolders = new Set(Object.values(clonePaths));
  return lines(output).flatMap((grepLine) => {
    const [prefixedFile = "", line = "", text = ""] = grepLine.split("\0");
    const file = prefixedFile.slice(refPrefix.length);
    if (isTestFile(file)) return [];
    return [...text.matchAll(mentionRegex)].flatMap(([path = ""]) =>
      cloneFolders.has(path) ? [] : [{ repo, file, line: Number(line), path }],
    );
  });
}

function isTestFile(file: string): boolean {
  return /\.test\.[^/]+$/.test(file) || file.includes("__snapshots__/");
}
