// The git helpers IssueWorkspaces.ts, WrapUp.ts and SpecRun.ts share.

import { execFile } from "node:child_process";
import { existsSync, readFileSync, realpathSync, statSync } from "node:fs";
import { join, resolve, sep } from "node:path";
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

export async function isDirty(worktree: string): Promise<boolean> {
  return hasChangesAt(worktree, []);
}

// No optional locks, so a status read never holds index.lock against a commit running in that worktree.
export async function hasChangesAt(
  worktree: string,
  pathspecs: string[],
): Promise<boolean> {
  const status = await git(
    worktree,
    "--no-optional-locks",
    "status",
    "--porcelain",
    "--",
    ...pathspecs,
  );
  return status !== "";
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

export interface WorktreeTarget {
  primaryClone: string;
  worktree: string;
}

type BranchOrigin =
  | { kind: "local" }
  | { kind: "remote"; remoteBranch: string }
  | { kind: "new" };

interface MatchingBranches {
  local: string[];
  // Each names its remote, as `origin/<branch>`.
  remote: string[];
}

export async function addWorktree({
  primaryClone,
  worktree,
  branch,
}: WorktreeTarget & { branch: string | undefined }): Promise<void> {
  if (branch === undefined) {
    await git(primaryClone, "worktree", "add", "--detach", worktree, "master");
    return;
  }
  await git(
    primaryClone,
    "worktree",
    "add",
    ...(await branchedWorktreeArgs({ primaryClone, worktree, branch })),
  );
}

async function branchedWorktreeArgs({
  primaryClone,
  worktree,
  branch,
}: WorktreeTarget & { branch: string }): Promise<string[]> {
  const origin = await branchOriginOf(primaryClone, branch);
  if (origin.kind === "local") return [worktree, branch];
  if (origin.kind === "remote") {
    return ["--track", "-b", branch, worktree, origin.remoteBranch];
  }
  return ["-b", branch, worktree, "master"];
}

export async function removeWorktree({
  primaryClone,
  worktree,
  force,
}: WorktreeTarget & { force: boolean }): Promise<void> {
  if (!existsSync(worktree)) return;
  const forceArgs = force ? ["--force"] : [];
  await git(primaryClone, "worktree", "remove", ...forceArgs, worktree);
}

async function registeredWorktreesOf(primaryClone: string): Promise<string[]> {
  const listing = await git(primaryClone, "worktree", "list", "--porcelain");
  return lines(listing).flatMap((line) =>
    line.startsWith("worktree ") ? [line.slice("worktree ".length)] : [],
  );
}

export async function isRegistered({
  primaryClone,
  worktree,
}: WorktreeTarget): Promise<boolean> {
  return (await registeredWorktreesOf(primaryClone)).includes(
    realpathSync(worktree),
  );
}

export async function worktreesInside(
  primaryClone: string,
  folder: string,
): Promise<string[]> {
  // Git records each worktree at its real path, so a symlinked workspace folder would match none.
  const realFolder = realpathSync(folder);
  return (await registeredWorktreesOf(primaryClone)).filter((worktree) =>
    worktree.startsWith(`${realFolder}${sep}`),
  );
}

// A new branch starts at the worktree's own HEAD, so edits made on the detached repo come along.
export async function switchArgs(
  worktree: string,
  branch: string,
): Promise<string[]> {
  const origin = await branchOriginOf(worktree, branch);
  if (origin.kind === "local") return [branch];
  if (origin.kind === "remote") {
    return ["--track", "-c", branch, origin.remoteBranch];
  }
  return ["-c", branch];
}

async function branchOriginOf(
  clone: string,
  branch: string,
): Promise<BranchOrigin> {
  const { local, remote } = await matchingBranchesOf(clone, branch);
  if (local.length > 0) return { kind: "local" };
  const [remoteBranch] = remote;
  if (remoteBranch !== undefined) return { kind: "remote", remoteBranch };
  return { kind: "new" };
}

// One for-each-ref over both patterns, read apart by prefix, so each ask starts one git process instead of two.
export async function matchingBranchesOf(
  clone: string,
  pattern: string,
): Promise<MatchingBranches> {
  const refs = lines(
    await git(
      clone,
      "for-each-ref",
      "--format=%(refname)",
      `refs/heads/${pattern}`,
      `refs/remotes/*/${pattern}`,
    ),
  );
  return {
    local: refsUnder(refs, "refs/heads/"),
    remote: refsUnder(refs, "refs/remotes/"),
  };
}

function refsUnder(refs: string[], prefix: string): string[] {
  return refs.flatMap((ref) =>
    ref.startsWith(prefix) ? [ref.slice(prefix.length)] : [],
  );
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

export async function revOf(worktree: string, ref: string): Promise<string> {
  return git(worktree, "rev-parse", ref);
}

export async function isMerging(worktree: string): Promise<boolean> {
  try {
    await git(worktree, "rev-parse", "-q", "--verify", "MERGE_HEAD");
    return true;
  } catch {
    return false;
  }
}

export async function isAncestor(
  worktree: string,
  ancestor: string,
  descendant: string,
): Promise<boolean> {
  try {
    await git(worktree, "merge-base", "--is-ancestor", ancestor, descendant);
    return true;
  } catch {
    return false;
  }
}

export function lines(output: string): string[] {
  return output === "" ? [] : output.split("\n");
}

export async function snapshotUncommitted(
  worktree: string,
  branchName: string,
): Promise<string | undefined> {
  const branch = await saveUncommitted(worktree, branchName);
  if (branch === undefined) return undefined;
  await git(worktree, "reset", "--hard", "HEAD");
  await git(worktree, "clean", "-fd");
  return branch;
}

// Commits the tree's uncommitted work, untracked files included, to a new branch without moving HEAD or changing the tree.
export async function saveUncommitted(
  worktree: string,
  branchName: string,
): Promise<string | undefined> {
  if (!(await isDirty(worktree))) return undefined;
  await git(worktree, "add", "-A");
  const tree = await git(worktree, "write-tree");
  const commit = await git(
    worktree,
    "commit-tree",
    tree,
    "-p",
    "HEAD",
    "-m",
    "Snapshot of a step's uncommitted work",
  );
  const branch = await freeBranchNameOf(worktree, branchName);
  await git(worktree, "branch", branch, commit);
  // Unstages what `add -A` staged, so the tree is left as the step left it.
  await git(worktree, "reset", "-q");
  return branch;
}

async function freeBranchNameOf(
  worktree: string,
  branchName: string,
): Promise<string> {
  let candidate = branchName;
  for (
    let suffix = 2;
    await hasRef(worktree, `refs/heads/${candidate}`);
    suffix++
  ) {
    candidate = `${branchName}-${suffix}`;
  }
  return candidate;
}
