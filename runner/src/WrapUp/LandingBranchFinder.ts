// Finds the branches a landing merges, as the repos whose workspace branch is ahead of master, and the branches its
// workspace made.

import { git, hasRef } from "../git.ts";
import {
  type IssueRef,
  type Workspace,
  workspaceLabelOf,
} from "../IssueWorkspaces.ts";
import { WrapUpBase } from "./WrapUpBase.ts";
import {
  type Landing,
  type LandingBranch,
  type Progress,
} from "./wrapUpTypes.ts";

export class LandingBranchFinder extends WrapUpBase {
  // Adds back any branch an earlier, unfinished landing found, which a partial fast-forward may have left level with master.
  async _issueBranchesOf(
    issue: IssueRef,
    progress: Progress,
  ): Promise<LandingBranch[]> {
    const workspace = await this._workspaceOf(issue);
    const ahead = await this._branchesAheadOf(workspace);
    const repos = new Set(
      [...ahead, ...(progress.branches ?? [])].map(({ repo }) => repo),
    );
    return this._landingOrderOf([...repos]).map((repo) => ({
      repo,
      branch: workspace.branch,
    }));
  }

  async _sessionBranchesOf(workspace: Workspace): Promise<LandingBranch[]> {
    const branches = await this._branchesAheadOf(workspace);
    if (branches.length === 0) {
      throw new Error(
        `${workspaceLabelOf(workspace.key)} has no commits ahead of master to land`,
      );
    }
    return branches;
  }

  // A ticket with no code or a session lists no branch to delete, but its workspace made one in each repo it branched.
  async _workspaceBranchesOf({ key }: Landing): Promise<LandingBranch[]> {
    const { branch } = await this._workspaceOf(key);
    const branches: LandingBranch[] = [];
    for (const repo of Object.keys(this.config.workspaces.clonePaths)) {
      const ref = await git(
        this._primaryOf(repo),
        "for-each-ref",
        "--format=%(refname:short)",
        `refs/heads/${branch}`,
      );
      if (ref !== "") branches.push({ repo, branch });
    }
    return branches;
  }

  private async _branchesAheadOf(
    workspace: Workspace,
  ): Promise<LandingBranch[]> {
    const repos = this._landingOrderOf(
      Object.keys(this.config.workspaces.clonePaths),
    );
    const branches: LandingBranch[] = [];
    for (const repo of repos) {
      const primary = this._primaryOf(repo);
      if (!(await hasRef(primary, `refs/heads/${workspace.branch}`))) continue;
      const ahead = await git(
        primary,
        "rev-list",
        "--count",
        `master..${workspace.branch}`,
      );
      if (Number(ahead) > 0) branches.push({ repo, branch: workspace.branch });
    }
    return branches;
  }

  // Landing order: the clones in the config's order, which puts a repo before any repo that depends on it, then the root.
  private _landingOrderOf(repos: string[]): string[] {
    const clones = Object.keys(this.config.workspaces.clonePaths).filter(
      (repo) => repo !== this._rootRepo,
    );
    return [...clones, this._rootRepo].filter((repo) => repos.includes(repo));
  }
}
