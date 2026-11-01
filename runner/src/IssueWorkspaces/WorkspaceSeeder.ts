// Seeds a new workspace's dependencies: clones the primary's node_modules and lockfile in, and installs when they can't be trusted.

import { execFile } from "node:child_process";
import {
  copyFileSync,
  existsSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
} from "node:fs";
import { join } from "node:path";
import { promisify } from "node:util";

import { IssueWorkspacesBase } from "./IssueWorkspacesBase.ts";

const execFileAsync = promisify(execFile);

const lockfileName = "package-lock.json";
const hiddenLockfileName = ".package-lock.json";
const cloneFlags =
  process.platform === "darwin" ? ["-cR"] : ["-R", "--reflink=auto"];

export class WorkspaceSeeder extends IssueWorkspacesBase {
  // macOS clones with -c and Linux with --reflink=auto (plain copy without it); npm-workspace links are relative, so they resolve to the workspace's own packages.
  async seedDependencies(path: string): Promise<void> {
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

  // The lockfile is gitignored, so a new worktree has none until the primary's is copied in.
  private _copyLockfile(path: string): void {
    const primary = this._primaryLockfile;
    if (existsSync(primary)) copyFileSync(primary, join(path, lockfileName));
  }

  // npm rewrites its hidden lockfile on every install, so one older than the lockfile means landing changed deps without a reinstall.
  private get _primaryIsStale(): boolean {
    const lockfile = this._primaryLockfile;
    const hidden = join(
      this.config.primaryRoot,
      "node_modules",
      hiddenLockfileName,
    );
    if (!existsSync(lockfile) || !existsSync(hidden)) return true;
    return statSync(hidden).mtimeMs < statSync(lockfile).mtimeMs;
  }

  // A missing lockfile counts as differing, so the installer still runs.
  private _lockfileMatches(path: string): boolean {
    const primary = this._primaryLockfile;
    const workspace = join(path, lockfileName);
    if (!existsSync(primary) || !existsSync(workspace)) return false;
    return readFileSync(primary).equals(readFileSync(workspace));
  }

  private get _primaryLockfile(): string {
    return join(this.config.primaryRoot, lockfileName);
  }
}
