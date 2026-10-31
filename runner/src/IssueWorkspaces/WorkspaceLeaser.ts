// Takes, releases and reads workspace leases: a lease is a file in the root worktree's git folder so it never shows as dirty; it is live while the process that took it runs on this machine, a dead holder's lease is taken over, and a holder holds one at a time.

import { readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { gitDirOf } from "../git.ts";
import {
  identityOf,
  isStillRunning,
  type ProcessIdentity,
} from "../processIdentity.ts";
import { assertLeaseFree, IssueWorkspacesBase } from "./IssueWorkspacesBase.ts";
import {
  isSameHolder,
  type Lease,
  type LeasedWorkspace,
  type LeaseHolder,
  type MaybeLeasedFolder,
  type Workspace,
  type WorkspaceKey,
} from "./workspaceTypes.ts";

const leaseFileName = "workspace.lease";

export class WorkspaceLeaser extends IssueWorkspacesBase {
  async takeLease(
    workspace: Pick<Workspace, "path">,
    holder: LeaseHolder,
  ): Promise<void> {
    const leasePath = leasePathOf(workspace.path);
    const { kind, pid } = holder;
    const leaseFile: LeaseFile = { kind, ...(await identityOf(pid)) };
    for (;;) {
      const lease = await readLease(leasePath);
      assertLeaseFree({ path: workspace.path, lease, holder });
      if (lease) rmSync(leasePath, { force: true });
      const content = JSON.stringify(leaseFile);
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

  async releaseOwnLease(
    workspace: Pick<Workspace, "path">,
    holder?: LeaseHolder,
  ): Promise<Lease | undefined> {
    const lease = await this.leaseOf(workspace);
    assertLeaseFree({ path: workspace.path, lease, holder });
    if (lease) await this.releaseLease(workspace);
    return lease;
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

  // The folder and its lease, with no git process, for a caller that checks or moves only the lease.
  async leasedFolderOf(
    key: WorkspaceKey,
  ): Promise<MaybeLeasedFolder | undefined> {
    const folder = this.folderOf(key);
    if (!folder) return undefined;
    return { ...folder, lease: await this.leaseOf(folder) };
  }
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
  const { kind, pid } = file;
  return { kind, pid, isLive: await isStillRunning(file) };
}

interface LeaseFile extends LeaseHolder, ProcessIdentity {}

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
