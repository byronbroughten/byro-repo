// Merges a landing's branches into each repo's master in the workspace, installs changed dependencies and runs the checks on the result, or with
// nothing to merge switches the workspace's repos to master. A failure restores the worktrees through WorktreeRestorer.

import { execFile } from "node:child_process";
import { promisify } from "node:util";

import { commandLabelOf, messageOf, outputTailOf } from "../failureText.ts";
import { git, isAncestor, isMerging, revOf } from "../git.ts";
import { type Workspace } from "../IssueWorkspaces.ts";
import { WrapUpFailure } from "../WrapUpFailure.ts";
import { WorktreeRestorer } from "./WorktreeRestorer.ts";
import { WrapUpBase } from "./WrapUpBase.ts";
import {
  type BuiltRepo,
  type Landing,
  type LandingBranch,
} from "./wrapUpTypes.ts";

const execFileAsync = promisify(execFile);

export class BranchMerger extends WrapUpBase {
  private get restorer(): WorktreeRestorer {
    return new WorktreeRestorer(this.config);
  }

  async _mergeAndCheck(landing: Landing, workspace: Workspace): Promise<void> {
    await this._step(landing, "merges", () => this._merge(landing, workspace));
    await this._step(landing, "checks", async () => {
      try {
        await this._installChangedDependencies(landing, workspace);
        await this._runChecks(workspace.path);
      } catch (error) {
        await this.restorer._restore(landing, workspace);
        throw error;
      }
    });
  }

  // With nothing to merge, the row goes on master, and a repo off the issue branch lets the wrap-up delete it.
  async _switchToMaster(workspace: Workspace): Promise<void> {
    for (const repo of new Set([this._rootRepo, ...workspace.branchedRepos])) {
      await git(
        this._worktreeOf(workspace, repo),
        "switch",
        "--detach",
        "master",
      );
    }
  }

  private async _merge(landing: Landing, workspace: Workspace): Promise<void> {
    try {
      await this.workspaces.resume(workspace);
    } catch (error) {
      throw new WrapUpFailure("dirty-tree", messageOf(error));
    }
    const built: Record<string, BuiltRepo> = {};
    for (const { repo, branch } of landing.branches) {
      const worktree = this._worktreeOf(workspace, repo);
      const base = await revOf(worktree, "master");
      await git(worktree, "switch", "--detach", "master");
      if (!(await isAncestor(worktree, branch, "master"))) {
        await this._mergeBranch(landing, workspace, { repo, branch });
      }
      built[repo] = { base, head: await revOf(worktree, "HEAD") };
      landing.progress.built = built;
    }
  }

  private async _mergeBranch(
    landing: Landing,
    workspace: Workspace,
    { repo, branch }: LandingBranch,
  ): Promise<void> {
    const worktree = this._worktreeOf(workspace, repo);
    try {
      await git(worktree, "merge", ...landing.kind.mergeArgs(branch));
    } catch (error) {
      if (await isMerging(worktree)) await git(worktree, "merge", "--abort");
      await this.restorer._restore(landing, workspace);
      throw new WrapUpFailure(
        "conflict",
        `Merging ${branch} into ${repo}'s master conflicts; the merge was aborted: ${messageOf(error)}`,
      );
    }
  }

  private async _installChangedDependencies(
    landing: Landing,
    workspace: Workspace,
  ): Promise<void> {
    await this._installIfDependenciesChanged(
      workspace.path,
      landing.branches.map(({ repo, branch }) => ({
        clone: this._worktreeOf(workspace, repo),
        from: branch,
        to: (landing.progress.built?.[repo] as BuiltRepo).head,
      })),
    );
  }

  private async _runChecks(workspaceRoot: string): Promise<void> {
    for (const [command, ...args] of this.config.mergeChecks) {
      try {
        await execFileAsync(command, args, {
          cwd: workspaceRoot,
          maxBuffer: 64 * 1024 * 1024,
        });
      } catch (error) {
        throw new WrapUpFailure(
          "red-checks",
          `${commandLabelOf([command, ...args])} failed after the merges:\n${outputTailOf(error)}`,
        );
      }
    }
  }
}
