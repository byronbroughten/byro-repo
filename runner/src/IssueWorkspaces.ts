// The workspace module: creates, lists, promotes, resumes and removes workspaces, each a byro-repo worktree in the injected
// workspace folder with a worktree of every package clone inside it, so work never moves a primary checkout's branch.
// An issue workspace is keyed by an IssueRef; a session workspace by a SessionKey, with every repo on its session branch.
// A lease is a run's or session's hold on one workspace, a file in its root worktree's git folder so it never shows as dirty;
// it is live while the process that took it runs on this machine, a dead holder's lease is taken over, and a holder holds one at a time.
// Everything repo-specific comes in as IssueWorkspacesConfig; byro-repo's values live in scripts/runner/.

import { execFile } from "node:child_process";
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { basename, join } from "node:path";
import { promisify } from "node:util";

import {
  currentBranchOf,
  dirtyReposOf,
  git,
  gitDirOf,
  lines,
  type RepoWorktree,
  worktreeStateOf,
} from "./git.ts";
import { LeaseHeld } from "./LeaseHeld.ts";
import { startTimeOf } from "./processStart.ts";

const execFileAsync = promisify(execFile);

const maxSlugWords = 6;
const lockfileName = "package-lock.json";
const hiddenLockfileName = ".package-lock.json";
const leaseFileName = "workspace.lease";
const cloneFlags =
  process.platform === "darwin" ? ["-cR"] : ["-R", "--reflink=auto"];

export interface IssueRef {
  repo: string;
  number: number;
}

export function isSameIssue(a: IssueRef, b: IssueRef): boolean {
  return a.repo === b.repo && a.number === b.number;
}

export interface SessionKey {
  session: string;
}

export type WorkspaceKey = IssueRef | SessionKey;

export function isSessionKey(key: WorkspaceKey): key is SessionKey {
  return "session" in key;
}

export function workspaceLabelOf(key: WorkspaceKey): string {
  if (isSessionKey(key)) return `session ${key.session}`;
  return issueLabelOf(key);
}

export function issueLabelOf({ repo, number }: IssueRef): string {
  return `${repo} #${number}`;
}

export function sessionBranchOf({ session }: SessionKey): string {
  return `${sessionBranchPrefix}${session}`;
}

// The issue as a file name's stem, for the state files kept per issue.
export function fileStemOf({ repo, number }: IssueRef): string {
  return `${repo}-${number}`;
}

export interface CreateOptions {
  slug?: string;
  // Repos besides the issue's own to start on the issue branch.
  extraRepos?: string[];
}

export interface IssueWorkspacesConfig {
  primaryRoot: string;
  // Repo name to its clone's path relative to the primary root; the root repo's is ".". Wrap-up lands clones in this order.
  clonePaths: Record<string, string>;
  workspaceFolder: string;
  // Gitignored files symlinked from each primary clone that has them.
  symlinkedFiles: string[];
  installDependencies(workspaceRoot: string): Promise<void>;
  issueTitle(issue: IssueRef): Promise<string>;
}

export interface Workspace {
  path: string;
  key: WorkspaceKey;
  branch: string;
  branchedRepos: string[];
}

export interface LeaseHolder {
  kind: "run" | "session";
  pid: number;
}

export interface Lease extends LeaseHolder {
  isLive: boolean;
}

export function isSameHolder(a: LeaseHolder, b: LeaseHolder): boolean {
  return a.kind === b.kind && a.pid === b.pid;
}

// The lease when someone other than the holder holds it live, undefined when the holder may take it.
export function otherLiveHolderOf(
  lease: Lease | undefined,
  holder?: LeaseHolder,
): Lease | undefined {
  if (!lease?.isLive || (holder && isSameHolder(holder, lease))) {
    return undefined;
  }
  return lease;
}

export function holderLabelOf({ kind, pid }: LeaseHolder): string {
  return `a ${kind} (pid ${pid})`;
}

interface KeyedFolder {
  path: string;
  key: WorkspaceKey;
}

interface MaybeLeasedFolder extends KeyedFolder {
  lease?: Lease;
}

export interface LeasedWorkspace extends KeyedFolder {
  lease: Lease;
}

export interface WorkspaceStatus extends Workspace {
  dirtyRepos: string[];
  createdAt: Date;
  lease?: Lease;
}

export interface RemoveOptions {
  force?: boolean;
  // The caller, whose own live lease doesn't block the removal.
  holder?: LeaseHolder;
}

export class IssueWorkspaces {
  private readonly config: IssueWorkspacesConfig;

  constructor(config: IssueWorkspacesConfig) {
    this.config = config;
  }

  static init(config: IssueWorkspacesConfig): IssueWorkspaces {
    return new IssueWorkspaces(config);
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
    if (holder) await this.takeLease(workspace, holder);
    return workspace;
  }

  async takeLease(
    workspace: Pick<Workspace, "path">,
    holder: LeaseHolder,
  ): Promise<void> {
    const leasePath = leasePathOf(workspace.path);
    const { kind, pid } = holder;
    const startedAt = await startTimeOf(pid);
    for (;;) {
      const lease = await readLease(leasePath);
      assertLeaseFree({ path: workspace.path, lease, holder });
      if (lease) rmSync(leasePath, { force: true });
      const content = JSON.stringify({ kind, pid, startedAt });
      if (tryCreate(leasePath, content)) break;
    }
    await this._releaseOtherLeasesOf(workspace, holder);
  }

  // Only the lease goes, so the released workspace keeps its unlanded commits and dirty files.
  private async _releaseOtherLeasesOf(
    workspace: Pick<Workspace, "path">,
    holder: LeaseHolder,
  ): Promise<void> {
    for (const { path, lease } of await this.leases()) {
      if (
        path !== workspace.path &&
        lease.isLive &&
        isSameHolder(lease, holder)
      ) {
        await this.releaseLease({ path });
      }
    }
  }

  async releaseLease({ path }: Pick<Workspace, "path">): Promise<void> {
    rmSync(leasePathOf(path), { force: true });
  }

  async leaseOf({ path }: Pick<Workspace, "path">): Promise<Lease | undefined> {
    return readLease(leasePathOf(path));
  }

  // Reads only the lease files, with none of list()'s git checks, so a session-end hook stays quick.
  async leases(): Promise<LeasedWorkspace[]> {
    const leased: LeasedWorkspace[] = [];
    for (const { path, key } of this._keyedFolders()) {
      const lease = await this.leaseOf({ path });
      if (lease) leased.push({ path, key, lease });
    }
    return leased;
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

  // The folder alone, with no git process, for a caller that needs only its path or lease.
  folderOf(key: WorkspaceKey): KeyedFolder | undefined {
    return this._keyedFolders().find((keyed) => isSameKey(keyed.key, key));
  }

  // The folder and its lease, with no git process, for a caller that checks or moves only the lease.
  async leasedFolderOf(
    key: WorkspaceKey,
  ): Promise<MaybeLeasedFolder | undefined> {
    const folder = this.folderOf(key);
    if (!folder) return undefined;
    return { ...folder, lease: await this.leaseOf(folder) };
  }

  async list(): Promise<WorkspaceStatus[]> {
    const workspaces: WorkspaceStatus[] = [];
    for (const { path, key } of this._keyedFolders()) {
      workspaces.push(await this._statusOf(path, key));
    }
    return workspaces;
  }

  private _keyedFolders(): KeyedFolder[] {
    if (!existsSync(this.config.workspaceFolder)) return [];
    return readdirSync(this.config.workspaceFolder)
      .sort()
      .flatMap((name) => {
        const key = this._keyOfFolder(name);
        if (!key) return [];
        return [{ path: join(this.config.workspaceFolder, name), key }];
      });
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
      lease: await this.leaseOf(workspace),
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
    Object.values(this.config.clonePaths).forEach((clonePath) => {
      this.config.symlinkedFiles.forEach((file) => {
        const target = join(this.config.primaryRoot, clonePath, file);
        if (existsSync(target)) {
          symlinkSync(target, join(path, clonePath, file));
        }
      });
    });
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

  private _repoWorktreesOf(path: string): Promise<RepoWorktree[]> {
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

  private _keyOfFolder(name: string): WorkspaceKey | undefined {
    if (name.startsWith(sessionBranchPrefix)) {
      return { session: name.slice(sessionBranchPrefix.length) };
    }
    for (const repo of Object.keys(this.config.clonePaths)) {
      const match = new RegExp(`^${escapeRegExp(repo)}-issue-(\\d+)-`).exec(
        name,
      );
      if (match?.[1] !== undefined) {
        return { repo, number: Number(match[1]) };
      }
    }
    return undefined;
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
      lease: await readLease(leasePathOf(path)),
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

const sessionBranchPrefix = "session-";

// A session folder is named for its branch alone; an issue folder leads with its repo, since issue numbers repeat across repos.
function folderPrefixOf(key: WorkspaceKey): string {
  if (isSessionKey(key)) return "";
  return `${key.repo}-`;
}

function isSameKey(a: WorkspaceKey, b: WorkspaceKey): boolean {
  if (isSessionKey(a) || isSessionKey(b)) {
    return isSessionKey(a) && isSessionKey(b) && a.session === b.session;
  }
  return isSameIssue(a, b);
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

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
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

// A worktree's .git file names its git folder, so the lease is found without a git process.
function leasePathOf(workspacePath: string): string {
  return join(gitDirOf(workspacePath), leaseFileName);
}

// An unreadable lease file counts as no lease, so a torn write never locks a workspace for good.
async function readLease(path: string): Promise<Lease | undefined> {
  let file: LeaseFile;
  try {
    file = JSON.parse(readFileSync(path, "utf8")) as LeaseFile;
  } catch {
    return undefined;
  }
  const { kind, pid, startedAt } = file;
  const startedNow = await startTimeOf(pid);
  return {
    kind,
    pid,
    isLive: startedNow !== undefined && startedNow === startedAt,
  };
}

interface LeaseFile extends LeaseHolder {
  startedAt?: string;
}

// The exclusive flag makes two takers racing for a free lease end with one holder.
function tryCreate(path: string, content: string): boolean {
  try {
    writeFileSync(path, content, { flag: "wx" });
    return true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "EEXIST") return false;
    throw error;
  }
}

interface LeaseCheck {
  path: string;
  lease: Lease | undefined;
  holder?: LeaseHolder;
}

function assertLeaseFree({ path, lease, holder }: LeaseCheck): void {
  const other = otherLiveHolderOf(lease, holder);
  if (!other) return;
  throw new LeaseHeld(
    `${path} is leased by ${holderLabelOf(other)}, which is still running`,
  );
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
