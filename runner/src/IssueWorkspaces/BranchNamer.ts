// BranchNamer names a workspace's branch, reusing an issue's existing branch in any repo; git.ts's branch lookup finds where a branch already exists.

import { matchingBranchesOf } from "../git.ts";
import { IssueWorkspacesBase } from "./IssueWorkspacesBase.ts";
import {
  type IssueRef,
  type WorkspaceKey,
  workspaceKey,
} from "./workspaceTypes.ts";

const maxSlugWords = 6;

export class BranchNamer extends IssueWorkspacesBase {
  async branchName(
    key: WorkspaceKey,
    slug: string | undefined,
  ): Promise<string> {
    if (workspaceKey.isSession(key)) return workspaceKey.sessionBranchOf(key);
    return this._issueBranchName(key, slug);
  }

  private async _issueBranchName(
    issue: IssueRef,
    slug: string | undefined,
  ): Promise<string> {
    const existing = await this._existingIssueBranch(issue);
    if (existing !== undefined) return existing;
    const title = slug ?? (await this.config.issueTitle(issue));
    return `${issueBranchPrefix(issue.number)}${slugOf(title)}`;
  }

  // The issue's own repo is asked first, since another repo's same-numbered branch may be a different issue.
  private async _existingIssueBranch(
    issue: IssueRef,
  ): Promise<string | undefined> {
    const repos = Object.keys(this.config.clonePaths).sort(
      (a, b) => Number(b === issue.repo) - Number(a === issue.repo),
    );
    for (const repo of repos) {
      const [branch] = await issueBranchesOf(
        this._primaryCloneOf(this._clonePathOf(repo)),
        issue.number,
      );
      if (branch !== undefined) return branch;
    }
    return undefined;
  }
}

function issueBranchPrefix(issueNumber: number): string {
  return `issue-${issueNumber}-`;
}

function slugOf(title: string): string {
  const words = title.toLowerCase().match(/[a-z0-9]+/g) ?? [];
  return words.slice(0, maxSlugWords).join("-");
}

async function issueBranchesOf(
  clone: string,
  issueNumber: number,
): Promise<string[]> {
  const { local, remote } = await matchingBranchesOf(
    clone,
    `${issueBranchPrefix(issueNumber)}*`,
  );
  return [...local, ...remote.map(withoutRemoteName)];
}

function withoutRemoteName(remoteBranch: string): string {
  return remoteBranch.slice(remoteBranch.indexOf("/") + 1);
}
