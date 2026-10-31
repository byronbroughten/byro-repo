// Builds, finds, promotes, resumes and removes workspaces, each a byro-repo worktree in the workspace folder with a worktree
// of every package clone inside it, and seeds each new one's dependencies; leases are WorkspaceLeaser's.

import { execFile } from "node:child_process";
import {
  copyFileSync,
  existsSync,
  lstatSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  realpathSync,
  rmSync,
  statSync,
  symlinkSync,
} from "node:fs";
import { basename, dirname, join, sep } from "node:path";
import { promisify } from "node:util";

import {
  currentBranchOf,
  dirtyReposOf,
  git,
  lines,
  type RepoWorktree,
  worktreeStateOf,
} from "../git.ts";
import { IssueWorkspacesBase } from "./IssueWorkspacesBase.ts";
import { assertLeaseFree, WorkspaceLeaser } from "./WorkspaceLeaser.ts";
import {
  type CreateOptions,
  fileStemOf,
  folderPrefixOf,
  isSessionKey,
  type IssueRef,
  type LeaseHolder,
  type RemoveOptions,
  sessionBranchOf,
  type SessionKey,
  type Workspace,
  type WorkspaceKey,
  type WorkspaceStatus,
} from "./workspaceTypes.ts";

const execFileAsync = promisify(execFile);

const maxSlugWords = 6;
const lockfileName = "package-lock.json";
const hiddenLockfileName = ".package-lock.json";
const cloneFlags =
  process.platform === "darwin" ? ["-cR"] : ["-R", "--reflink=auto"];

export class WorkspaceBuilder extends IssueWorkspacesBase {
  private get leaser(): WorkspaceLeaser {
    return new WorkspaceLeaser(this.config);
  }

  async create(
    key: WorkspaceKey,
    options: CreateOptions = {},
  ): Promise<Workspace> {
    if (isSessionKey(key)) assertSessionCreate(key, options);
    const branchedRepos = this._branchedReposOf(key, options);
    const existing = await this.find(key);
    if (existing) {
      return {
        path: existing.path,
        key,
        branch: existing.branch,
        branchedRepos: existing.branchedRepos,
      };
    }
    const branch = await this._branchName(key, options.slug);
    const path = join(
      this.config.workspaceFolder,
      `${folderPrefixOf(key)}${branch}`,
    );
    await this._buildOrTearDown({ path, branch, branchedRepos });
    return { path, key, branch, branchedRepos };
  }

  // The lease is checked before resume, which would move another holder's detached repos.
  async start(key: WorkspaceKey, holder?: LeaseHolder): Promise<Workspace> {
    const existing = await this.find(key);
    if (existing) {
      assertLeaseFree({ path: existing.path, lease: existing.lease, holder });
      await this.resume(existing);
    }
    const workspace = existing ?? (await this.create(key));
    if (holder) await this.leaser.takeLease(workspace, holder);
    return workspace;
  }

  // Every repo detached at its master, rebuilt on each call so it holds exactly the commits master points to now.
  async masterSet(spec: IssueRef): Promise<string> {
    const path = join(
      this.config.workspaceFolder,
      `master-${fileStemOf(spec)}`,
    );
    // Removed and pruned rather than torn down, so a half-removed set from a killed run can't block the rebuild.
    rmSync(path, { recursive: true, force: true });
    await this._pruneWorktrees();
    await this._buildOrTearDown({ path, branchedRepos: [] });
    return path;
  }

  // Reads only the matching folder's repos, since each status read is a git process.
  async find(key: WorkspaceKey): Promise<WorkspaceStatus | undefined> {
    const folder = this.folderOf(key);
    if (!folder) return undefined;
    return this._statusOf(folder.path, folder.key);
  }

  async list(): Promise<WorkspaceStatus[]> {
    const workspaces: WorkspaceStatus[] = [];
    for (const { path, key } of this._keyedFolders()) {
      workspaces.push(await this._statusOf(path, key));
    }
    return workspaces;
  }

  async promote(workspace: Workspace, repo: string): Promise<Workspace> {
    const worktree = this._worktreeOf(workspace, repo);
    const checkedOut = currentBranchOf(worktree);
    if (checkedOut !== "" && checkedOut !== workspace.branch) {
      throw new Error(
        `${repo} in ${workspace.path} is on ${checkedOut}; only a detached repo can be promoted onto ${workspace.branch}`,
      );
    }
    if (checkedOut === "") {
      await git(
        worktree,
        "switch",
        ...(await switchArgs(worktree, workspace.branch)),
      );
    }
    const { path, key, branch, branchedRepos } = await this._statusOf(
      workspace.path,
      workspace.key,
    );
    return { path, key, branch, branchedRepos };
  }

  async resume(workspace: Workspace): Promise<void> {
    const detached = detachedOf(await this._repoWorktreesOf(workspace.path));
    const dirtyRepos = dirtyReposOf(detached);
    const orphanedRepos = await orphanedReposOf(detached);
    if (dirtyRepos.length > 0 || orphanedRepos.length > 0) {
      throw new Error(
        `${workspace.path} has ${unsavedWork(dirtyRepos, orphanedRepos)}; promote the repo to keep its work, or discard it, before resuming`,
      );
    }
    for (const { worktree } of detached) {
      await git(worktree, "switch", "--detach", "master");
    }
  }

  async remove(
    workspace: Pick<Workspace, "path">,
    { force = false, holder }: RemoveOptions = {},
  ): Promise<void> {
    assertLeaseFree({
      path: workspace.path,
      lease: await this.leaser.leaseOf(workspace),
      holder,
    });
    const worktrees = await this._repoWorktreesOf(workspace.path);
    const dirtyRepos = dirtyReposOf(worktrees);
    const orphanedRepos = await orphanedReposOf(detachedOf(worktrees));
    if ((dirtyRepos.length > 0 || orphanedRepos.length > 0) && !force) {
      throw new Error(
        `${workspace.path} has ${unsavedWork(dirtyRepos, orphanedRepos)}; remove it with force to discard them`,
      );
    }
    await this._tearDown(workspace.path, force);
  }

  private _branchedReposOf(
    key: WorkspaceKey,
    options: CreateOptions,
  ): string[] {
    if (isSessionKey(key)) return this._clonesRootFirst.map(([repo]) => repo);
    const branchedRepos = [key.repo, ...(options.extraRepos ?? [])];
    branchedRepos.forEach((repo) => this._clonePathOf(repo));
    return branchedRepos;
  }

  private async _branchName(
    key: WorkspaceKey,
    slug: string | undefined,
  ): Promise<string> {
    if (isSessionKey(key)) return sessionBranchOf(key);
    return this._issueBranchName(key, slug);
  }

  private async _issueBranchName(
    issue: IssueRef,
    slug: string | undefined,
  ): Promise<string> {
    const existing = await this._existingIssueBranch(issue);
    if (existing !== undefined) return existing;
    const title = slug ?? (await this.config.issueTitle(issue));
    return `${issueBranchPrefix(issue.number)}${slugOf(title)}`;
  }

  // The issue's own repo is asked first, since another repo's same-numbered branch may be a different issue.
  private async _existingIssueBranch(
    issue: IssueRef,
  ): Promise<string | undefined> {
    const repos = Object.keys(this.config.clonePaths).sort(
      (a, b) => Number(b === issue.repo) - Number(a === issue.repo),
    );
    for (const repo of repos) {
      const [branch] = await issueBranchesOf(
        join(this.config.primaryRoot, this._clonePathOf(repo)),
        issue.number,
      );
      if (branch !== undefined) return branch;
    }
    return undefined;
  }

  private async _buildOrTearDown(target: BuildTarget): Promise<void> {
    mkdirSync(this.config.workspaceFolder, { recursive: true });
    try {
      await this._build(target);
    } catch (error) {
      // A half-built folder would otherwise pass as the existing workspace on the next create.
      await this._tearDown(target.path, true);
      throw error;
    }
  }

  private async _build({
    path,
    branch,
    branchedRepos,
  }: BuildTarget): Promise<void> {
    for (const [repo, clonePath] of this._clonesRootFirst) {
      await addWorktree({
        primaryClone: join(this.config.primaryRoot, clonePath),
        worktree: join(path, clonePath),
        branch: branchedRepos.includes(repo) ? branch : undefined,
      });
    }
    this._linkSharedFiles(path);
    await this._seedDependencies(path);
  }

  private _linkSharedFiles(path: string): void {
    Object.values(this.config.clonePaths).forEach((clonePath) =>
      this._linkSharedFilesOf(path, clonePath),
    );
  }

  private _linkSharedFilesOf(path: string, clonePath: string): void {
    this.config.symlinkedFiles.forEach((file) =>
      linkSharedFile({
        target: join(this.config.primaryRoot, clonePath, file),
        link: join(path, clonePath, file),
      }),
    );
  }

  // macOS clones with -c and Linux with --reflink=auto (plain copy without it); npm-workspace links are relative, so they resolve to the workspace's own packages.
  private async _seedDependencies(path: string): Promise<void> {
    let copyFailed = false;
    for (const folder of this._dependencyFolders) {
      const from = join(this.config.primaryRoot, folder, "node_modules");
      const to = join(path, folder, "node_modules");
      if (!existsSync(from) || !existsSync(join(path, folder))) continue;
      try {
        await execFileAsync("cp", [...cloneFlags, from, to]);
      } catch {
        copyFailed = true;
        rmSync(to, { recursive: true, force: true });
      }
    }
    this._copyLockfile(path);
    if (copyFailed || this._primaryIsStale || !this._lockfileMatches(path)) {
      await this.config.installDependencies(path);
    }
  }

  // The lockfile is gitignored, so a new worktree has none until the primary's is copied in.
  private _copyLockfile(path: string): void {
    const primary = join(this.config.primaryRoot, lockfileName);
    if (existsSync(primary)) copyFileSync(primary, join(path, lockfileName));
  }

  // A missing lockfile counts as differing, so the installer still runs.
  private _lockfileMatches(path: string): boolean {
    const primary = join(this.config.primaryRoot, lockfileName);
    const workspace = join(path, lockfileName);
    if (!existsSync(primary) || !existsSync(workspace)) return false;
    return readFileSync(primary).equals(readFileSync(workspace));
  }

  // npm rewrites its hidden lockfile on every install, so one older than the lockfile means landing changed deps without a reinstall.
  private get _primaryIsStale(): boolean {
    const lockfile = join(this.config.primaryRoot, lockfileName);
    const hidden = join(
      this.config.primaryRoot,
      "node_modules",
      hiddenLockfileName,
    );
    if (!existsSync(lockfile) || !existsSync(hidden)) return true;
    return statSync(hidden).mtimeMs < statSync(lockfile).mtimeMs;
  }

  // Top-level folders too, since npm workspaces such as runner/ keep their own node_modules.
  private get _dependencyFolders(): string[] {
    const topLevel = readdirSync(this.config.primaryRoot, {
      withFileTypes: true,
    })
      .filter((entry) => entry.isDirectory() && entry.name !== "node_modules")
      .map((entry) => entry.name);
    return [
      ...new Set([".", ...topLevel, ...Object.values(this.config.clonePaths)]),
    ];
  }

  private _worktreeOf(workspace: Workspace, repo: string): string {
    const worktree = join(workspace.path, this._clonePathOf(repo));
    if (!existsSync(worktree)) {
      throw new Error(`${workspace.path} has no worktree for ${repo}`);
    }
    return worktree;
  }

  private async _repoWorktreesOf(path: string): Promise<RepoWorktree[]> {
    await this._relocateMovedWorktrees(path);
    const present = this._clonesRootFirst
      .map(([repo, clonePath]) => ({ repo, worktree: join(path, clonePath) }))
      .filter(({ worktree }) => existsSync(worktree));
    return Promise.all(
      present.map(async ({ repo, worktree }) => ({
        repo,
        worktree,
        state: await worktreeStateOf(worktree),
      })),
    );
  }

  // A workspace built before its primary clone moved holds that repo's worktree at the old folder, which every path here would miss.
  private async _relocateMovedWorktrees(path: string): Promise<void> {
    for (const clonePath of Object.values(this.config.clonePaths)) {
      const worktree = join(path, clonePath);
      const primaryClone = join(this.config.primaryRoot, clonePath);
      if (existsSync(worktree) || !existsSync(primaryClone)) continue;
      // The moved primary's linked worktrees still point at its old folder until repaired.
      await git(primaryClone, "worktree", "repair");
      const [moved] = await worktreesInside(primaryClone, path);
      if (moved === undefined) continue;
      mkdirSync(dirname(worktree), { recursive: true });
      await git(primaryClone, "worktree", "move", moved, worktree);
      this._linkSharedFilesOf(path, clonePath);
    }
  }

  private _clonePathOf(repo: string): string {
    const clonePath = this.config.clonePaths[repo];
    if (clonePath === undefined) {
      throw new Error(`${repo} is not in the workspace config's clone paths`);
    }
    return clonePath;
  }

  private get _clonesRootFirst(): [string, string][] {
    return Object.entries(this.config.clonePaths).sort(
      ([, a], [, b]) => a.length - b.length,
    );
  }

  private async _statusOf(
    path: string,
    key: WorkspaceKey,
  ): Promise<WorkspaceStatus> {
    const worktrees = await this._repoWorktreesOf(path);
    const branchedRepos = worktrees
      .filter(({ state }) => state.branch !== "")
      .map(({ repo }) => repo);
    const dirtyRepos = dirtyReposOf(worktrees);
    return {
      path,
      key,
      // From the folder, which create() names after the branch, so it survives the repos being detached.
      branch: basename(path).slice(folderPrefixOf(key).length),
      branchedRepos,
      dirtyRepos,
      createdAt: statSync(path).birthtime,
      lease: await this.leaser.leaseOf({ path }),
    };
  }

  private async _tearDown(path: string, force: boolean): Promise<void> {
    const deepestFirst = this._clonesRootFirst.reverse();
    for (const [, clonePath] of deepestFirst) {
      await removeWorktree({
        primaryClone: join(this.config.primaryRoot, clonePath),
        worktree: join(path, clonePath),
        force,
      });
    }
    rmSync(path, { recursive: true, force: true });
    await this._pruneWorktrees();
  }

  private async _pruneWorktrees(): Promise<void> {
    for (const clonePath of Object.values(this.config.clonePaths)) {
      await git(join(this.config.primaryRoot, clonePath), "worktree", "prune");
    }
  }
}

// Repos outside branchedRepos are detached at master, so a set with none needs no branch.
interface BuildTarget {
  path: string;
  branch?: string;
  branchedRepos: string[];
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

interface WorktreeTarget {
  primaryClone: string;
  worktree: string;
}

interface SharedFileLink {
  target: string;
  link: string;
}

function assertSessionCreate(
  { session }: SessionKey,
  { slug, extraRepos }: CreateOptions,
): void {
  if (slug !== undefined || extraRepos !== undefined) {
    throw new Error(
      `A slug or extra repos are for an issue workspace; session ${session} puts every repo on its branch`,
    );
  }
  if (/^[a-z0-9]+(-[a-z0-9]+)*$/.test(session)) return;
  throw new Error(
    `"${session}" is not a session slug; use lowercase words joined by hyphens`,
  );
}

function issueBranchPrefix(issueNumber: number): string {
  return `issue-${issueNumber}-`;
}

function slugOf(title: string): string {
  const words = title.toLowerCase().match(/[a-z0-9]+/g) ?? [];
  return words.slice(0, maxSlugWords).join("-");
}

async function issueBranchesOf(
  clone: string,
  issueNumber: number,
): Promise<string[]> {
  const { local, remote } = await matchingBranchesOf(
    clone,
    `${issueBranchPrefix(issueNumber)}*`,
  );
  return [...local, ...remote.map(withoutRemoteName)];
}

// One for-each-ref over both patterns, read apart by prefix, so each ask starts one git process instead of two.
async function matchingBranchesOf(
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

function withoutRemoteName(remoteBranch: string): string {
  return remoteBranch.slice(remoteBranch.indexOf("/") + 1);
}

async function addWorktree({
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

// A new branch starts at the worktree's own HEAD, so edits made on the detached repo come along.
async function switchArgs(worktree: string, branch: string): Promise<string[]> {
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

// A link a moved primary clone left pointing at its old folder is replaced; a real file in its place is the developer's and stays.
function linkSharedFile({ target, link }: SharedFileLink): void {
  if (!existsSync(target)) return;
  if (lstatSync(link, { throwIfNoEntry: false })?.isSymbolicLink()) {
    rmSync(link);
  }
  if (!existsSync(link)) symlinkSync(target, link);
}

async function worktreesInside(
  primaryClone: string,
  folder: string,
): Promise<string[]> {
  const listing = await git(primaryClone, "worktree", "list", "--porcelain");
  // Git records each worktree at its real path, so a symlinked workspace folder would match none.
  const realFolder = realpathSync(folder);
  return lines(listing).flatMap((line) => {
    if (!line.startsWith("worktree ")) return [];
    const worktree = line.slice("worktree ".length);
    return worktree.startsWith(`${realFolder}${sep}`) ? [worktree] : [];
  });
}

async function removeWorktree({
  primaryClone,
  worktree,
  force,
}: WorktreeTarget & { force: boolean }): Promise<void> {
  if (!existsSync(worktree)) return;
  const forceArgs = force ? ["--force"] : [];
  await git(primaryClone, "worktree", "remove", ...forceArgs, worktree);
}

function detachedOf(worktrees: RepoWorktree[]): RepoWorktree[] {
  return worktrees.filter(({ state }) => state.branch === "");
}

async function orphanedReposOf(detached: RepoWorktree[]): Promise<string[]> {
  const orphaned: string[] = [];
  for (const { repo, worktree } of detached) {
    if (await isOrphanedHead(worktree)) orphaned.push(repo);
  }
  return orphaned;
}

// A detached HEAD no branch contains is reachable only from the reflog, so moving off it or removing its worktree loses the commits.
async function isOrphanedHead(worktree: string): Promise<boolean> {
  const containing = await git(
    worktree,
    "for-each-ref",
    "--contains",
    "HEAD",
    "refs/heads",
    "refs/remotes",
  );
  return containing === "";
}

function unsavedWork(dirtyRepos: string[], orphanedRepos: string[]): string {
  const parts: string[] = [];
  if (dirtyRepos.length > 0) {
    parts.push(`uncommitted changes in ${dirtyRepos.join(", ")}`);
  }
  if (orphanedRepos.length > 0) {
    parts.push(`commits on no branch in ${orphanedRepos.join(", ")}`);
  }
  return parts.join(" and ");
}
