// Lands a ticket's or session's branches up to the fast-forward: restores the worktrees, checks them clean, counts the
// files changed, refuses stale paths, then builds the merges and fast-forwards, rebuilding when a master moved.
// Nothing reaches a primary checkout before the fast-forward, so an unlanded rerun starts over from the branches.

import { git, isDirty, lines } from "../git.ts";
import { type Workspace } from "../IssueWorkspaces.ts";
import { stalePathLabelOf, stalePathsTouchedBy } from "../stalePaths.ts";
import { WrapUpFailure } from "../WrapUpFailure.ts";
import { FastForwarder } from "./FastForwarder.ts";
import { WorktreeRestorer } from "./WorktreeRestorer.ts";
import { WrapUpBase } from "./WrapUpBase.ts";
import {
  type Landing,
  type UnswitchedDirtiness,
  type WrapUpStep,
} from "./wrapUpTypes.ts";

interface CleanCheckTarget {
  workspace: Workspace;
  unswitchedDirtiness: UnswitchedDirtiness;
}

const buildSteps: WrapUpStep[] = ["merges", "checks", "log-row"];

export class BranchLander extends WrapUpBase {
  private get restorer(): WorktreeRestorer {
    return new WorktreeRestorer(this.config);
  }

  private get fastForwarder(): FastForwarder {
    return new FastForwarder(this.config);
  }

  async _land(landing: Landing): Promise<void> {
    const workspace = await this._workspaceOf(landing.key);
    const unswitchedDirtiness = await this.restorer._restore(
      landing,
      workspace,
    );
    landing.progress = { completed: [], branches: landing.branches };
    await this._step(landing, "clean-check", () =>
      this._cleanCheck(landing, { workspace, unswitchedDirtiness }),
    );
    await this._step(landing, "files-changed", async () => {
      landing.progress.filesChanged = await this._filesChanged(landing);
    });
    await this._refuseStalePaths(landing);
    for (;;) {
      await landing.kind.build(landing, workspace);
      if (await this.fastForwarder._fastForward(landing)) return;
      this._log("A master moved while the merges were checked; rebuilding.");
      await this.restorer._restore(landing, workspace);
      landing.progress.completed = landing.progress.completed.filter(
        (step) => !buildSteps.includes(step),
      );
    }
  }

  private async _cleanCheck(
    landing: Landing,
    { workspace, unswitchedDirtiness }: CleanCheckTarget,
  ): Promise<void> {
    for (const repo of this._landedRepos(landing)) {
      await this._assertOnMaster(repo);
    }
    for (const repo of landing.kind.cleanRepos(landing)) {
      const isRepoDirty =
        unswitchedDirtiness[repo] ??
        (await isDirty(this._worktreeOf(workspace, repo)));
      if (isRepoDirty) {
        throw new WrapUpFailure(
          "dirty-tree",
          `${repo} in ${workspace.path} has uncommitted changes`,
        );
      }
    }
  }

  // The listed repos in landing order, then the root repo, which takes the log row.
  private _landedRepos(landing: Landing): string[] {
    return [
      ...new Set([...landing.branches.map(({ repo }) => repo), this._rootRepo]),
    ];
  }

  private async _filesChanged(landing: Landing): Promise<number> {
    let count = 0;
    for (const { repo, branch } of landing.branches) {
      const files = await git(
        this._primaryOf(repo),
        "diff",
        "--name-only",
        `master...${branch}`,
      );
      count += lines(files).length;
    }
    return count;
  }

  // Only the files the change touches, so a migration's tickets land one at a time past stale paths elsewhere.
  private async _refuseStalePaths(landing: Landing): Promise<void> {
    const found = await stalePathsTouchedBy(
      this.config.workspaces,
      landing.branches,
    );
    if (found.length === 0) return;
    throw new WrapUpFailure(
      "stale-path",
      `The change names folders that hold no clone, so nothing was merged:\n${found.map(stalePathLabelOf).join("\n")}`,
    );
  }
}
