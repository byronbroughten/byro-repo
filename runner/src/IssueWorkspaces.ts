// The workspace module: creates, lists and removes issue workspaces, each a byro-repo worktree outside the
// primary root with a worktree of every package clone inside it, so tickets never move a primary checkout's branch.
// Everything repo-specific comes in as IssueWorkspacesConfig; byro-repo's values live in scripts/runner/.

import { execFile } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  readdirSync,
  rmSync,
  statSync,
  symlinkSync,
} from "node:fs";
import { join } from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

const maxSlugWords = 6;

export interface IssueRef {
  repo: string;
  number: number;
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
  issue: IssueRef;
  branch: string;
  branchedRepos: string[];
}

export interface WorkspaceStatus extends Workspace {
  // Repos with uncommitted or untracked changes.
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
    issue: IssueRef,
    options: CreateOptions = {},
  ): Promise<Workspace> {
    const branchedRepos = [issue.repo, ...(options.extraRepos ?? [])];
    branchedRepos.forEach((repo) => this._assertKnownRepo(repo));
    const existing = await this.find(issue);
    if (existing) {
      const { path, branch, branchedRepos } = existing;
      return { path, issue, branch, branchedRepos };
    }
    const branch = await this._branchName(issue, options.slug);
    const path = join(this.config.workspaceFolder, `${issue.repo}-${branch}`);
    mkdirSync(this.config.workspaceFolder, { recursive: true });
    for (const [repo, clonePath] of this._clonesRootFirst()) {
      await this._addWorktree({
        primaryClone: join(this.config.primaryRoot, clonePath),
        worktree: join(path, clonePath),
        branch: branchedRepos.includes(repo) ? branch : undefined,
      });
    }
    this._linkSharedFiles(path);
    await this._seedDependencies(path);
    return { path, issue, branch, branchedRepos };
  }

  private async _branchName(
    issue: IssueRef,
    slug: string | undefined,
  ): Promise<string> {
    const existing = await this._existingIssueBranch(issue);
    if (existing !== undefined) return existing;
    const title = slug ?? (await this.config.issueTitle(issue));
    return `issue-${issue.number}-${slugOf(title)}`;
  }

  // The issue's own repo is asked first, since another repo's same-numbered branch may be a different issue.
  private async _existingIssueBranch(
    issue: IssueRef,
  ): Promise<string | undefined> {
    const repos = Object.keys(this.config.clonePaths).sort(
      (a, b) => Number(b === issue.repo) - Number(a === issue.repo),
    );
    for (const repo of repos) {
      const branches = await issueBranchesOf(
        this._primaryClone(repo),
        issue.number,
      );
      if (branches[0] !== undefined) return branches[0];
    }
    return undefined;
  }

  private _primaryClone(repo: string): string {
    return join(this.config.primaryRoot, this._assertKnownRepo(repo));
  }

  private _assertKnownRepo(repo: string): string {
    const clonePath = this.config.clonePaths[repo];
    if (clonePath === undefined) {
      throw new Error(`${repo} is not in the workspace config's clone paths`);
    }
    return clonePath;
  }

  private _clonesRootFirst(): [string, string][] {
    return Object.entries(this.config.clonePaths).sort(
      ([, a], [, b]) => a.length - b.length,
    );
  }

  private async _addWorktree({
    primaryClone,
    worktree,
    branch,
  }: {
    primaryClone: string;
    worktree: string;
    branch: string | undefined;
  }): Promise<void> {
    if (branch === undefined) {
      await git(
        primaryClone,
        "worktree",
        "add",
        "--detach",
        worktree,
        "master",
      );
      return;
    }
    await git(
      primaryClone,
      "worktree",
      "add",
      ...(await branchedWorktreeArgs({ primaryClone, worktree, branch })),
    );
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

  // A copy-on-write clone is near-instant on APFS; the installer then reconciles, or does the whole install where cloning failed.
  private async _seedDependencies(path: string): Promise<void> {
    for (const folder of this._dependencyFolders()) {
      const from = join(this.config.primaryRoot, folder, "node_modules");
      const to = join(path, folder, "node_modules");
      if (!existsSync(from) || !existsSync(join(path, folder))) continue;
      try {
        await execFileAsync("cp", ["-cR", from, to]);
      } catch {
        rmSync(to, { recursive: true, force: true });
      }
    }
    await this.config.installDependencies(path);
  }

  // The root, its top-level folders (npm workspaces such as runner/) and each clone.
  private _dependencyFolders(): string[] {
    const topLevel = readdirSync(this.config.primaryRoot, {
      withFileTypes: true,
    })
      .filter((entry) => entry.isDirectory() && entry.name !== "node_modules")
      .map((entry) => entry.name);
    return [
      ...new Set([".", ...topLevel, ...Object.values(this.config.clonePaths)]),
    ];
  }

  async find(issue: IssueRef): Promise<WorkspaceStatus | undefined> {
    const workspaces = await this.list();
    return workspaces.find(
      (workspace) =>
        workspace.issue.repo === issue.repo &&
        workspace.issue.number === issue.number,
    );
  }

  async list(): Promise<WorkspaceStatus[]> {
    if (!existsSync(this.config.workspaceFolder)) return [];
    const workspaces: WorkspaceStatus[] = [];
    for (const name of readdirSync(this.config.workspaceFolder).sort()) {
      const issue = this._issueOfFolder(name);
      if (!issue) continue;
      workspaces.push(
        await this._statusOf(join(this.config.workspaceFolder, name), issue),
      );
    }
    return workspaces;
  }

  async remove(
    workspace: Workspace,
    { force = false }: RemoveOptions = {},
  ): Promise<void> {
    const { dirtyRepos } = await this._statusOf(
      workspace.path,
      workspace.issue,
    );
    if (dirtyRepos.length > 0 && !force) {
      throw new Error(
        `${workspace.path} has uncommitted changes in ${dirtyRepos.join(", ")}; remove it with force to discard them`,
      );
    }
    const deepestFirst = this._clonesRootFirst().reverse();
    for (const [, clonePath] of deepestFirst) {
      await removeWorktree({
        primaryClone: join(this.config.primaryRoot, clonePath),
        worktree: join(workspace.path, clonePath),
        force,
      });
    }
    rmSync(workspace.path, { recursive: true, force: true });
    for (const [, clonePath] of deepestFirst) {
      await git(join(this.config.primaryRoot, clonePath), "worktree", "prune");
    }
  }

  private _issueOfFolder(name: string): IssueRef | undefined {
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

  private async _statusOf(
    path: string,
    issue: IssueRef,
  ): Promise<WorkspaceStatus> {
    const branchedRepos: string[] = [];
    const dirtyRepos: string[] = [];
    let branch = "";
    for (const [repo, clonePath] of this._clonesRootFirst()) {
      const worktree = join(path, clonePath);
      if (!existsSync(worktree)) continue;
      const checkedOut = await git(worktree, "branch", "--show-current");
      if (checkedOut !== "") branchedRepos.push(repo);
      if (repo === issue.repo) branch = checkedOut;
      if ((await git(worktree, "status", "--porcelain")) !== "") {
        dirtyRepos.push(repo);
      }
    }
    return {
      path,
      issue,
      branch,
      branchedRepos,
      dirtyRepos,
      createdAt: statSync(path).birthtime,
    };
  }
}

function slugOf(title: string): string {
  const words = title.toLowerCase().match(/[a-z0-9]+/g) ?? [];
  return words.slice(0, maxSlugWords).join("-");
}

async function issueBranchesOf(
  clone: string,
  issueNumber: number,
): Promise<string[]> {
  const pattern = `issue-${issueNumber}-*`;
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

function lines(output: string): string[] {
  return output === "" ? [] : output.split("\n");
}

async function branchedWorktreeArgs({
  primaryClone,
  worktree,
  branch,
}: {
  primaryClone: string;
  worktree: string;
  branch: string;
}): Promise<string[]> {
  if (await hasRef(primaryClone, `refs/heads/${branch}`)) {
    return [worktree, branch];
  }
  const [remoteBranch] = await remoteBranchesOf(primaryClone, branch);
  if (remoteBranch !== undefined) {
    return ["--track", "-b", branch, worktree, remoteBranch];
  }
  return ["-b", branch, worktree, "master"];
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

async function removeWorktree({
  primaryClone,
  worktree,
  force,
}: {
  primaryClone: string;
  worktree: string;
  force: boolean;
}): Promise<void> {
  if (!existsSync(worktree)) return;
  const forceArgs = force ? ["--force"] : [];
  await git(primaryClone, "worktree", "remove", ...forceArgs, worktree);
}

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

async function git(cwd: string, ...args: string[]): Promise<string> {
  const { stdout } = await execFileAsync("git", args, { cwd });
  return stdout.trim();
}
