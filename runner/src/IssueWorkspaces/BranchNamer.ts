// BranchNamer names a workspace's branch, reusing an issue's existing branch in its own repo, and finds other repos' same-numbered branches; git.ts's branch lookup finds where a branch already exists.

import { matchingBranchesOf } from "../git.ts";
import { IssueWorkspacesBase } from "./IssueWorkspacesBase.ts";
import {
  type IssueRef,
  type RepoBranch,
  type WorkspaceKey,
  workspaceKey,
} from "./workspaceTypes.ts";

const maxSlugWords = 6;

export interface ChosenBranch {
  branch: string;
  otherIssueBranches: RepoBranch[];
}

export class BranchNamer extends IssueWorkspacesBase {
  async branchOf(
    key: WorkspaceKey,
    slug: string | undefined,
  ): Promise<ChosenBranch> {
    if (workspaceKey.isSession(key)) {
      return {
        branch: workspaceKey.sessionBranchOf(key),
        otherIssueBranches: [],
      };
    }
    const branch = await this._issueBranchName(key, slug);
    return {
      branch,
      otherIssueBranches: await this._otherIssueBranches(key, branch),
    };
  }

  private async _issueBranchName(
    issue: IssueRef,
    slug: string | undefined,
  ): Promise<string> {
    const [existing] = await this._issueBranchesIn(issue.repo, issue.number);
    if (existing !== undefined) return existing;
    const title = slug ?? (await this.config.issueTitle(issue));
    return `${issueBranchPrefix(issue.number)}${slugOf(title)}`;
  }

  // Another repo's same-numbered branch is another issue's, since a branch's number reads against its own repo.
  private async _otherIssueBranches(
    issue: IssueRef,
    chosen: string,
  ): Promise<RepoBranch[]> {
    const others: RepoBranch[] = [];
    for (const repo of Object.keys(this.config.clonePaths)) {
      if (repo === issue.repo) continue;
      for (const branch of await this._issueBranchesIn(repo, issue.number)) {
        if (branch !== chosen) others.push({ repo, branch });
      }
    }
    return others;
  }

  private _issueBranchesIn(
    repo: string,
    issueNumber: number,
  ): Promise<string[]> {
    return issueBranchesOf(
      this._primaryCloneOf(this._clonePathOf(repo)),
      issueNumber,
    );
  }
}

function issueBranchPrefix(issueNumber: number): string {
  return `issue-${issueNumber}-`;
}

function slugOf(title: string): string {
  const words = title.toLowerCase().match(/[a-z0-9]+/g) ?? [];
  return words.slice(0, maxSlugWords).join("-");
}

// A branch both local and pushed is listed once.
async function issueBranchesOf(
  clone: string,
  issueNumber: number,
): Promise<string[]> {
  const { local, remote } = await matchingBranchesOf(
    clone,
    `${issueBranchPrefix(issueNumber)}*`,
  );
  return [...new Set([...local, ...remote.map(withoutRemoteName)])];
}

function withoutRemoteName(remoteBranch: string): string {
  return remoteBranch.slice(remoteBranch.indexOf("/") + 1);
}
