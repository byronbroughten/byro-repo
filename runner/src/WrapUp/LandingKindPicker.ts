// Picks what differs between a ticket that lands branches, one with no code and a session: how each builds, which repos
// must be clean, which branches it deletes and how it merges. It builds BranchMerger, LogRowCommitter and LandingBranchFinder.

import { type WrapUpFacts } from "../FactsFile.ts";
import { type IssueRef } from "../IssueWorkspaces.ts";
import { BranchMerger } from "./BranchMerger.ts";
import { LandingBranchFinder } from "./LandingBranchFinder.ts";
import { LogRowCommitter } from "./LogRowCommitter.ts";
import { WrapUpBase } from "./WrapUpBase.ts";
import {
  type Landing,
  type LandingBranch,
  type LandingKind,
} from "./wrapUpTypes.ts";

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

  _issueLandingOf(
    issue: IssueRef,
    { branches, facts }: IssueLandingTarget,
  ): LandingKind {
    if (branches.length === 0) {
      return {
        build: async (landing, workspace) => {
          await this.merger._switchToMaster(workspace);
          await this.logRowCommitter._logRow({
            issue,
            facts,
            landing,
            workspace,
          });
        },
        cleanRepos: () => [this._rootRepo],
        branchesToDelete: (landing) =>
          this.branchFinder._workspaceBranchesOf(landing),
        mergeArgs: (branch) => issueMergeArgsOf(issue, branch),
      };
    }
    return {
      build: async (landing, workspace) => {
        await this.merger._mergeAndCheck(landing, workspace);
        await this.logRowCommitter._logRow({
          issue,
          facts,
          landing,
          workspace,
        });
      },
      cleanRepos: listedReposOf,
      branchesToDelete: async ({ branches }) => branches,
      mergeArgs: (branch) => issueMergeArgsOf(issue, branch),
    };
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
}

export function listedReposOf({
  branches,
}: Pick<Landing, "branches">): string[] {
  return branches.map(({ repo }) => repo);
}

function issueMergeArgsOf({ number }: IssueRef, branch: string): string[] {
  return ["--no-ff", "-m", `Merge ${branch} into master (#${number})`, branch];
}

// A session's branch fast-forwards master when it can, so a mid-session landing adds no merge commit.
function sessionMergeArgsOf(branch: string): string[] {
  return ["-m", `Merge ${branch} into master`, branch];
}
