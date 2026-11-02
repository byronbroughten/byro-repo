// Keeps the workspace lifecycle: creates, finds, lists, promotes, resumes and removes workspaces.
// Branch names are BranchNamer's, dependency seeding WorkspaceSeeder's and leases WorkspaceLeaser's.

import {
  existsSync,
  lstatSync,
  mkdirSync,
  rmSync,
  statSync,
  symlinkSync,
} from "node:fs";
import { basename, dirname, join } from "node:path";

import {
  addWorktree,
  currentBranchOf,
  dirtyReposOf,
  git,
  isRegistered,
  removeWorktree,
  type RepoWorktree,
  switchArgs,
  worktreesInside,
  worktreeStateOf,
  type WorktreeTarget,
} from "../git.ts";
import { BranchNamer } from "./BranchNamer.ts";
import { assertClaudeEntriesDeletable } from "./claudeEntries.ts";
import { assertLeaseFree, IssueWorkspacesBase } from "./IssueWorkspacesBase.ts";
import { WorkspaceLeaser } from "./WorkspaceLeaser.ts";
import { WorkspaceSeeder } from "./WorkspaceSeeder.ts";
import {
  type CreateOptions,
  fileStemOf,
  folderPrefixOf,
  isSessionKey,
  type IssueRef,
  type LeaseHolder,
  type RemoveOptions,
  type SessionKey,
  type Workspace,
  type WorkspaceKey,
  type WorkspaceStatus,
} from "./workspaceTypes.ts";

export class WorkspaceKeeper extends IssueWorkspacesBase {
  private get leaser(): WorkspaceLeaser {
    return new WorkspaceLeaser(this.config);
  }

  private get namer(): BranchNamer {
    return new BranchNamer(this.config);
  }

  private get seeder(): WorkspaceSeeder {
    return new WorkspaceSeeder(this.config);
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
    const branch = await this.namer.branchName(key, options.slug);
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
    assertClaudeEntriesDeletable({
      path: workspace.path,
      clonePaths: Object.values(this.config.clonePaths),
      removeCommand: this.config.removeCommand,
    });
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
        primaryClone: this._primaryCloneOf(clonePath),
        worktree: join(path, clonePath),
        branch: branchedRepos.includes(repo) ? branch : undefined,
      });
    }
    this._linkSharedFiles(path);
    await this.seeder.seedDependencies(path);
  }

  private _linkSharedFiles(path: string): void {
    Object.values(this.config.clonePaths).forEach((clonePath) =>
      this._linkSharedFilesOf(path, clonePath),
    );
  }

  private _linkSharedFilesOf(path: string, clonePath: string): void {
    this.config.symlinkedFiles.forEach((file) =>
      linkSharedFile({
        target: join(this._primaryCloneOf(clonePath), file),
        link: join(path, clonePath, file),
      }),
    );
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
    const registered = await this._registeredWorktreesOf(path);
    return Promise.all(
      registered.map(async ({ repo, worktree }) => ({
        repo,
        worktree,
        state: await worktreeStateOf(worktree),
      })),
    );
  }

  // A folder git no longer lists, left by a removal stopped part-way, has no git state, and a git process in it would read an outer repo's.
  private async _registeredWorktreesOf(
    path: string,
  ): Promise<RepoWorktreeTarget[]> {
    const present = this._clonesRootFirst
      .map(([repo, clonePath]) => ({
        repo,
        primaryClone: this._primaryCloneOf(clonePath),
        worktree: join(path, clonePath),
      }))
      .filter(({ worktree }) => existsSync(worktree));
    const isEachRegistered = await Promise.all(present.map(isRegistered));
    return present.filter((_, index) => isEachRegistered[index]);
  }

  // A workspace built before its primary clone moved holds that repo's worktree at the old folder, which every path here would miss.
  private async _relocateMovedWorktrees(path: string): Promise<void> {
    for (const clonePath of Object.values(this.config.clonePaths)) {
      const worktree = join(path, clonePath);
      const primaryClone = this._primaryCloneOf(clonePath);
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
    const isBroken = !worktrees.some(({ worktree }) => worktree === path);
    return {
      ...(isBroken && { isBroken }),
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

  // A repo's folder git no longer lists goes with the folder; the prune then clears any record left.
  private async _tearDown(path: string, force: boolean): Promise<void> {
    const deepestFirst = (await this._registeredWorktreesOf(path)).reverse();
    for (const { primaryClone, worktree } of deepestFirst) {
      await removeWorktree({ primaryClone, worktree, force });
    }
    rmSync(path, { recursive: true, force: true });
    await this._pruneWorktrees();
  }

  private async _pruneWorktrees(): Promise<void> {
    for (const clonePath of Object.values(this.config.clonePaths)) {
      await git(this._primaryCloneOf(clonePath), "worktree", "prune");
    }
  }
}

// Repos outside branchedRepos are detached at master, so a set with none needs no branch.
interface BuildTarget {
  path: string;
  branch?: string;
  branchedRepos: string[];
}

interface RepoWorktreeTarget extends WorktreeTarget {
  repo: string;
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

// A link a moved primary clone left pointing at its old folder is replaced; a real file in its place is the developer's and stays.
function linkSharedFile({ target, link }: SharedFileLink): void {
  if (!existsSync(target)) return;
  if (lstatSync(link, { throwIfNoEntry: false })?.isSymbolicLink()) {
    rmSync(link);
  }
  if (!existsSync(link)) symlinkSync(target, link);
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
