// The stale-path check: each packages/<dir> mention in tracked text, test files aside, whose folder holds no clone.
import { execFile } from "node:child_process";
import { join } from "node:path";
import { promisify } from "node:util";

import { git, lines } from "./git.ts";
import type { IssueWorkspacesConfig } from "./IssueWorkspaces.ts";
import type { LandingBranch } from "./WrapUp.ts";

const execFileAsync = promisify(execFile);

// Not inside a longer name, and a trailing dot ends a sentence, not the folder.
const mentionRegex = /(?<![\w-])packages\/([\w.-]*[\w-])/g;

export interface StalePath {
  repo: string;
  file: string;
  line: number;
  path: string;
}

export type RepoMap = Pick<IssueWorkspacesConfig, "primaryRoot" | "clonePaths">;

interface RepoGrep {
  repo: string;
  // A branch and the files to read at its tip; unset, every tracked file in the worktree.
  touched?: { branch: string; files: string[] };
}

export async function stalePathsOf(repoMap: RepoMap): Promise<StalePath[]> {
  const found = await Promise.all(
    Object.keys(repoMap.clonePaths).map((repo) =>
      repoStalePathsOf(repoMap, { repo }),
    ),
  );
  return found.flat();
}

// Read at each branch's tip, so the worktree's state doesn't matter; a deleted file names nothing.
export async function stalePathsTouchedBy(
  repoMap: RepoMap,
  branches: LandingBranch[],
): Promise<StalePath[]> {
  const found = await Promise.all(
    branches.map(async ({ repo, branch }) => {
      const files = lines(
        await git(
          folderOf(repoMap, repo),
          "diff",
          "--name-only",
          "--diff-filter=d",
          "--no-renames",
          `master...${branch}`,
        ),
      );
      if (files.length === 0) return [];
      return repoStalePathsOf(repoMap, { repo, touched: { branch, files } });
    }),
  );
  return found.flat();
}

export function stalePathLabelOf({
  repo,
  file,
  line,
  path,
}: StalePath): string {
  return `${repo} ${file}:${line} names ${path}, which holds no clone`;
}

async function repoStalePathsOf(
  repoMap: RepoMap,
  { repo, touched }: RepoGrep,
): Promise<StalePath[]> {
  const args = touched ? [touched.branch, "--", ...touched.files] : [];
  const output = await grepOf(folderOf(repoMap, repo), args);
  // git grep names a file read at a branch as `<branch>:<file>`.
  const refPrefix = touched ? `${touched.branch}:` : "";
  const cloneFolders = new Set(Object.values(repoMap.clonePaths));
  return lines(output).flatMap((grepLine) => {
    const [prefixedFile = "", line = "", text = ""] = grepLine.split("\0");
    const file = prefixedFile.slice(refPrefix.length);
    if (isTestFile(file)) return [];
    return [...text.matchAll(mentionRegex)].flatMap(([path = ""]) =>
      cloneFolders.has(path) ? [] : [{ repo, file, line: Number(line), path }],
    );
  });
}

function folderOf({ primaryRoot, clonePaths }: RepoMap, repo: string): string {
  const clonePath = clonePaths[repo];
  if (clonePath === undefined) {
    throw new Error(`${repo} has no clone in the repo map`);
  }
  return join(primaryRoot, clonePath);
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

function isTestFile(file: string): boolean {
  return /\.test\.[^/]+$/.test(file) || file.includes("__snapshots__/");
}
