// Picks what differs between a ticket that lands branches, one with no code and a session: how each builds, which repos
// must be clean, which branches it deletes and how it merges. It builds BranchMerger, LogRowCommitter and LandingBranchFinder.

import { type WrapUpFacts } from "../FactsFile.ts";
import { type IssueRef } from "../IssueWorkspaces.ts";
import { BranchMerger } from "./BranchMerger.ts";
import { LandingBranchFinder } from "./LandingBranchFinder.ts";
import { LogRowCommitter } from "./LogRowCommitter.ts";
import { listedReposOf, WrapUpBase } from "./WrapUpBase.ts";
import { type LandingBranch, type LandingKind } from "./wrapUpTypes.ts";

export interface IssueLandingTarget {
  branches: LandingBranch[];
  facts: WrapUpFacts;
}

export class LandingKindPicker extends WrapUpBase {
  private get merger(): BranchMerger {
    return new BranchMerger(this.config);
  }

  private get logRowCommitter(): LogRowCommitter {
    return new LogRowCommitter(this.config);
  }

  private get branchFinder(): LandingBranchFinder {
    return new LandingBranchFinder(this.config);
  }

  get _sessionLanding(): LandingKind {
    return {
      build: async (landing, workspace) =>
        this.merger._mergeAndCheck(landing, workspace),
      cleanRepos: () => Object.keys(this.config.workspaces.clonePaths),
      branchesToDelete: async (landing) => {
        await this.merger._switchToMaster(await this._workspaceOf(landing.key));
        return this.branchFinder._workspaceBranchesOf(landing);
      },
      mergeArgs: sessionMergeArgsOf,
    };
  }

  _issueLandingOf(
    issue: IssueRef,
    { branches, facts }: IssueLandingTarget,
  ): LandingKind {
    const hasCode = branches.length > 0;
    return {
      build: async (landing, workspace) => {
        if (hasCode) {
          await this.merger._mergeAndCheck(landing, workspace);
        } else {
          await this.merger._switchToMaster(workspace);
        }
        await this.logRowCommitter._logRow({
          issue,
          facts,
          landing,
          workspace,
        });
      },
      cleanRepos: (landing) => {
        if (hasCode) return listedReposOf(landing);
        return [this._rootRepo];
      },
      branchesToDelete: async (landing) => {
        if (hasCode) return landing.branches;
        return this.branchFinder._workspaceBranchesOf(landing);
      },
      mergeArgs: (branch) => issueMergeArgsOf(issue, branch),
    };
  }
}

function issueMergeArgsOf({ number }: IssueRef, branch: string): string[] {
  return ["--no-ff", "-m", `Merge ${branch} into master (#${number})`, branch];
}

// A session's branch fast-forwards master when it can, so a mid-session landing adds no merge commit.
function sessionMergeArgsOf(branch: string): string[] {
  return ["-m", `Merge ${branch} into master`, branch];
}
