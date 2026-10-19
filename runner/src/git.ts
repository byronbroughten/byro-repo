// The git helpers IssueWorkspaces.ts, WrapUp.ts and SpecRun.ts share.

import { execFile } from "node:child_process";
import { readFileSync, statSync } from "node:fs";
import { join, resolve } from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

export async function git(cwd: string, ...args: string[]): Promise<string> {
  // A whole landing's diff can outgrow execFile's 1 MB default.
  const { stdout } = await execFileAsync("git", args, {
    cwd,
    maxBuffer: 64 * 1024 * 1024,
  });
  return stdout.trim();
}

// No optional locks, so a status read never holds index.lock against a commit running in that worktree.
export async function isDirty(worktree: string): Promise<boolean> {
  return (
    (await git(worktree, "--no-optional-locks", "status", "--porcelain")) !== ""
  );
}

export interface WorktreeState {
  // Empty when HEAD is detached, as `currentBranchOf` returns.
  branch: string;
  head: string;
  isDirty: boolean;
}

// One status read for all three, so they describe the same moment; no optional locks, as isDirty.
export async function worktreeStateOf(
  worktree: string,
): Promise<WorktreeState> {
  const output = await git(
    worktree,
    "--no-optional-locks",
    "status",
    "--porcelain=v2",
    "--branch",
  );
  const state: WorktreeState = { branch: "", head: "", isDirty: false };
  lines(output).forEach((line) => {
    if (line.startsWith("# branch.oid ")) {
      state.head = line.slice("# branch.oid ".length);
    } else if (line.startsWith("# branch.head ")) {
      const branch = line.slice("# branch.head ".length);
      state.branch = branch === "(detached)" ? "" : branch;
    } else if (!line.startsWith("# ")) {
      state.isDirty = true;
    }
  });
  return state;
}

export interface RepoWorktree {
  repo: string;
  worktree: string;
  state: WorktreeState;
}

export function dirtyReposOf(worktrees: RepoWorktree[]): string[] {
  return worktrees.filter(({ state }) => state.isDirty).map(({ repo }) => repo);
}

// Read from HEAD itself, so no git process starts.
export function currentBranchOf(worktree: string): string {
  const head = readFileSync(join(gitDirOf(worktree), "HEAD"), "utf8");
  return /^ref: refs\/heads\/(.+)$/.exec(head.trim())?.[1] ?? "";
}

// A linked worktree's .git file names its git folder, maybe relative to the worktree.
export function gitDirOf(worktree: string): string {
  const dotGit = join(worktree, ".git");
  if (statSync(dotGit).isDirectory()) return dotGit;
  const gitDir = readFileSync(dotGit, "utf8")
    .trim()
    .replace(/^gitdir: /, "");
  return resolve(worktree, gitDir);
}

export async function hasRef(clone: string, ref: string): Promise<boolean> {
  return (await git(clone, "for-each-ref", "--format=%(refname)", ref)) !== "";
}

export function lines(output: string): string[] {
  return output === "" ? [] : output.split("\n");
}
