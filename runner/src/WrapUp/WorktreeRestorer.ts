// Undoes any earlier build: each listed repo back on its branch and the root off an unlanded log-row commit.

import { git, isMerging, worktreeStateOf } from "../git.ts";
import { type Workspace } from "../IssueWorkspaces.ts";
import { listedReposOf, WrapUpBase } from "./WrapUpBase.ts";
import { type Landing, type UnswitchedDirtiness } from "./wrapUpTypes.ts";

export class WorktreeRestorer extends WrapUpBase {
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
      !listedReposOf(landing).includes(this._rootRepo) &&
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
