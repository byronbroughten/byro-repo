// Puts a landing's worktrees back where they were before a build: each listed repo on its branch, the root off an unlanded log-row commit.

import { git, isMerging, worktreeStateOf } from "../git.ts";
import { type Workspace } from "../IssueWorkspaces.ts";
import { WrapUpBase } from "./WrapUpBase.ts";
import { type Landing, type UnswitchedDirtiness } from "./wrapUpTypes.ts";

export class WorktreeRestorer extends WrapUpBase {
  // Puts each listed repo back on its branch and the root off an unlanded log-row commit, undoing any earlier build.
  async _restore(
    landing: Landing,
    workspace: Workspace,
  ): Promise<UnswitchedDirtiness> {
    const unswitchedDirtiness: UnswitchedDirtiness = {};
    for (const { repo, branch } of landing.branches) {
      const worktree = this._worktreeOf(workspace, repo);
      if (await isMerging(worktree)) await git(worktree, "merge", "--abort");
      const state = await worktreeStateOf(worktree);
      if (state.branch !== branch) {
        await git(worktree, "switch", branch);
      } else {
        unswitchedDirtiness[repo] = state.isDirty;
      }
    }
    const rootHead = landing.progress.built?.[this._rootRepo]?.head;
    const rootWorktree = this._worktreeOf(workspace, this._rootRepo);
    const { branch, head, isDirty } = await worktreeStateOf(rootWorktree);
    if (
      !isListed(landing, this._rootRepo) &&
      branch === "" &&
      head === rootHead
    ) {
      await git(rootWorktree, "switch", "--detach", "master");
    } else {
      unswitchedDirtiness[this._rootRepo] = isDirty;
    }
    delete landing.progress.built;
    return unswitchedDirtiness;
  }
}

function isListed(landing: Landing, repo: string): boolean {
  return landing.branches.some((branch) => branch.repo === repo);
}
