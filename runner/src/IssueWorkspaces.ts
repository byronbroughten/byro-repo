// The workspace module: creates, lists, promotes, resumes and removes workspaces, each a byro-repo worktree outside the
// primary root with a worktree of every package clone inside it, so work never moves a primary checkout's branch.
// An issue workspace is keyed by an IssueRef; a session workspace by a SessionKey, with every repo on its session branch.
// Everything repo-specific comes in as IssueWorkspacesConfig; byro-repo's values live in scripts/runner/.

import { execFile } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  symlinkSync,
} from "node:fs";
import { basename, join } from "node:path";
import { promisify } from "node:util";

import { git, lines } from "./git.ts";

const execFileAsync = promisify(execFile);

const maxSlugWords = 6;
const lockfileName = "package-lock.json";

export interface IssueRef {
  repo: string;
  number: number;
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
  // Repo name to its clone's path relative to the primary root; the root repo's is ".".
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

export interface WorkspaceStatus extends Workspace {
  dirtyRepos: string[];
  createdAt: Date;
}

export interface RemoveOptions {
  force?: boolean;
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

  async start(key: WorkspaceKey): Promise<Workspace> {
    const existing = await this.find(key);
    if (!existing) return this.create(key);
    await this.resume(existing);
    return existing;
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

  async find(key: WorkspaceKey): Promise<WorkspaceStatus | undefined> {
    const workspaces = await this.list();
    return workspaces.find((workspace) => isSameKey(workspace.key, key));
  }

  async list(): Promise<WorkspaceStatus[]> {
    if (!existsSync(this.config.workspaceFolder)) return [];
    const workspaces: WorkspaceStatus[] = [];
    for (const name of readdirSync(this.config.workspaceFolder).sort()) {
      const key = this._keyOfFolder(name);
      if (!key) continue;
      workspaces.push(
        await this._statusOf(join(this.config.workspaceFolder, name), key),
      );
    }
    return workspaces;
  }

  async promote(workspace: Workspace, repo: string): Promise<Workspace> {
    const worktree = this._worktreeOf(workspace, repo);
    const checkedOut = await currentBranchOf(worktree);
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
    const detached = await this._detachedWorktrees(workspace);
    const dirtyRepos: string[] = [];
    for (const { repo, worktree } of detached) {
      if (await isDirty(worktree)) dirtyRepos.push(repo);
    }
    const orphanedRepos = await this._orphanedRepos(workspace);
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
    workspace: Workspace,
    { force = false }: RemoveOptions = {},
  ): Promise<void> {
    const { dirtyRepos } = await this._statusOf(workspace.path, workspace.key);
    const orphanedRepos = await this._orphanedRepos(workspace);
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
    if (isSessionKey(key)) return `${sessionBranchPrefix}${key.session}`;
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

  // A copy-on-write clone is near-instant on APFS and its npm-workspace links are relative, so it resolves to the workspace's own packages.
  private async _seedDependencies(path: string): Promise<void> {
    let copyFailed = false;
    for (const folder of this._dependencyFolders) {
      const from = join(this.config.primaryRoot, folder, "node_modules");
      const to = join(path, folder, "node_modules");
      if (!existsSync(from) || !existsSync(join(path, folder))) continue;
      try {
        await execFileAsync("cp", ["-cR", from, to]);
      } catch {
        copyFailed = true;
        rmSync(to, { recursive: true, force: true });
      }
    }
    if (copyFailed || !this._lockfileMatches(path)) {
      await this.config.installDependencies(path);
    }
  }

  // A missing lockfile counts as differing, so the installer still runs.
  private _lockfileMatches(path: string): boolean {
    const primary = join(this.config.primaryRoot, lockfileName);
    const workspace = join(path, lockfileName);
    if (!existsSync(primary) || !existsSync(workspace)) return false;
    return readFileSync(primary).equals(readFileSync(workspace));
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

  private async _detachedWorktrees(
    workspace: Workspace,
  ): Promise<DetachedWorktree[]> {
    const detached: DetachedWorktree[] = [];
    for (const [repo, clonePath] of this._clonesRootFirst) {
      const worktree = join(workspace.path, clonePath);
      if (!existsSync(worktree)) continue;
      if ((await currentBranchOf(worktree)) === "") {
        detached.push({ repo, worktree });
      }
    }
    return detached;
  }

  private async _orphanedRepos(workspace: Workspace): Promise<string[]> {
    const orphaned: string[] = [];
    for (const { repo, worktree } of await this._detachedWorktrees(workspace)) {
      if (await isOrphanedHead(worktree)) orphaned.push(repo);
    }
    return orphaned;
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
    const branchedRepos: string[] = [];
    const dirtyRepos: string[] = [];
    for (const [repo, clonePath] of this._clonesRootFirst) {
      const worktree = join(path, clonePath);
      if (!existsSync(worktree)) continue;
      const checkedOut = await currentBranchOf(worktree);
      if (checkedOut !== "") branchedRepos.push(repo);
      if (await isDirty(worktree)) dirtyRepos.push(repo);
    }
    return {
      path,
      key,
      // From the folder, which create() names after the branch, so it survives the repos being detached.
      branch: basename(path).slice(folderPrefixOf(key).length),
      branchedRepos,
      dirtyRepos,
      createdAt: statSync(path).birthtime,
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

interface DetachedWorktree {
  repo: string;
  worktree: string;
}

type BranchOrigin =
  | { kind: "local" }
  | { kind: "remote"; remoteBranch: string }
  | { kind: "new" };

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
  return a.repo === b.repo && a.number === b.number;
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
  const pattern = `${issueBranchPrefix(issueNumber)}*`;
  const local = lines(
    await git(
      clone,
      "for-each-ref",
      "--format=%(refname:lstrip=2)",
      `refs/heads/${pattern}`,
    ),
  );
  const remote = lines(
    await git(
      clone,
      "for-each-ref",
      "--format=%(refname:lstrip=3)",
      `refs/remotes/*/${pattern}`,
    ),
  );
  return [...local, ...remote];
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
  if (await hasRef(clone, `refs/heads/${branch}`)) return { kind: "local" };
  const [remoteBranch] = await remoteBranchesOf(clone, branch);
  if (remoteBranch !== undefined) return { kind: "remote", remoteBranch };
  return { kind: "new" };
}

async function hasRef(clone: string, ref: string): Promise<boolean> {
  return (await git(clone, "for-each-ref", "--format=%(refname)", ref)) !== "";
}

async function remoteBranchesOf(
  clone: string,
  branch: string,
): Promise<string[]> {
  return lines(
    await git(
      clone,
      "for-each-ref",
      "--format=%(refname:lstrip=2)",
      `refs/remotes/*/${branch}`,
    ),
  );
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

async function currentBranchOf(worktree: string): Promise<string> {
  return git(worktree, "branch", "--show-current");
}

async function isDirty(worktree: string): Promise<boolean> {
  return (await git(worktree, "status", "--porcelain")) !== "";
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
