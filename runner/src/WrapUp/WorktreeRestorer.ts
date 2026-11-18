// Undoes any earlier build: each listed repo back on its branch.

import { git, isMerging, worktreeStateOf } from "../git.ts";
import { type Workspace } from "../IssueWorkspaces.ts";
import { WrapUpBase } from "./WrapUpBase.ts";
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
    delete landing.progress.built;
    return unswitchedDirtiness;
  }
}
