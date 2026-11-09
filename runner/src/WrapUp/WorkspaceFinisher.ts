// Ends a workspace's life for WrapUp: the free-lease check, leveling a kept session's repos with master and removing
// the workspace. All three take a workspace key, not a Landing.

import { messageOf } from "../failureText.ts";
import { currentBranchOf, git, isAncestor } from "../git.ts";
import {
  type LeaseHolder,
  leaseHolder,
  type SessionKey,
  type WorkspaceKey,
  workspaceKey,
} from "../IssueWorkspaces.ts";
import { LeaseHeld } from "../LeaseHeld.ts";
import { WrapUpFailure } from "../WrapUpFailure.ts";
import { WrapUpBase } from "./WrapUpBase.ts";

export class WorkspaceFinisher extends WrapUpBase {
  async _assertLeaseFree(
    key: SessionKey,
    holder: LeaseHolder | undefined,
  ): Promise<void> {
    const folder = await this.workspaces.leasedFolderOf(key);
    const other = leaseHolder.otherLiveOf(folder?.lease, holder);
    if (!other) return;
    throw new LeaseHeld(
      `${workspaceKey.labelOf(key)} is leased by ${leaseHolder.labelOf(other)}, which is still running`,
    );
  }

  // A landed repo sits detached on master, so its branch moves there, keeping any commit or edit made since.
  async _levelWorkspace(key: SessionKey): Promise<void> {
    const workspace = await this._workspaceOf(key);
    for (const repo of Object.keys(this.config.workspaces.clonePaths)) {
      const worktree = this._worktreeOf(workspace, repo);
      try {
        await levelRepo(worktree, workspace.branch);
      } catch (error) {
        throw new WrapUpFailure(
          "dirty-tree",
          `Leveling ${repo} in ${workspace.path} with master failed, likely over changes made since the landing: ${messageOf(error)}`,
        );
      }
    }
  }

  async _removeWorkspace(key: WorkspaceKey): Promise<void> {
    const folder = await this.workspaces.leasedFolderOf(key);
    if (!folder) return;
    const { lease } = folder;
    await this.workspaces.releaseLease(folder);
    try {
      await this.workspaces.remove(folder);
    } catch (error) {
      // A half torn-down workspace may have nowhere left to hold a lease.
      if (lease?.isLive) {
        await this.workspaces.takeLease(folder, lease).catch(() => {});
      }
      throw error;
    }
  }
}

async function levelRepo(worktree: string, branch: string): Promise<void> {
  if (currentBranchOf(worktree) !== branch) {
    if (await isAncestor(worktree, branch, "HEAD")) {
      await git(worktree, "switch", "-C", branch);
    } else {
      await git(worktree, "switch", branch);
    }
  }
  if (await isAncestor(worktree, branch, "master")) {
    await git(worktree, "merge", "--ff-only", "master");
  }
}
