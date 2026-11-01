// Names a workspace's branch, reusing an issue's existing branch in any repo, and finds where a branch already exists.

import { join } from "node:path";

import { git, lines } from "../git.ts";
import { IssueWorkspacesBase } from "./IssueWorkspacesBase.ts";
import {
  isSessionKey,
  type IssueRef,
  sessionBranchOf,
  type WorkspaceKey,
} from "./workspaceTypes.ts";

const maxSlugWords = 6;

export type BranchOrigin =
  | { kind: "local" }
  | { kind: "remote"; remoteBranch: string }
  | { kind: "new" };

export class BranchNamer extends IssueWorkspacesBase {
  async branchName(
    key: WorkspaceKey,
    slug: string | undefined,
  ): Promise<string> {
    if (isSessionKey(key)) return sessionBranchOf(key);
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
        join(this.config.primaryRoot, this._clonePathOf(repo)),
        issue.number,
      );
      if (branch !== undefined) return branch;
    }
    return undefined;
  }
}

interface MatchingBranches {
  local: string[];
  // Each names its remote, as `origin/<branch>`.
  remote: string[];
}

export async function branchOriginOf(
  clone: string,
  branch: string,
): Promise<BranchOrigin> {
  const { local, remote } = await matchingBranchesOf(clone, branch);
  if (local.length > 0) return { kind: "local" };
  const [remoteBranch] = remote;
  if (remoteBranch !== undefined) return { kind: "remote", remoteBranch };
  return { kind: "new" };
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

// One for-each-ref over both patterns, read apart by prefix, so each ask starts one git process instead of two.
async function matchingBranchesOf(
  clone: string,
  pattern: string,
): Promise<MatchingBranches> {
  const refs = lines(
    await git(
      clone,
      "for-each-ref",
      "--format=%(refname)",
      `refs/heads/${pattern}`,
      `refs/remotes/*/${pattern}`,
    ),
  );
  return {
    local: refsUnder(refs, "refs/heads/"),
    remote: refsUnder(refs, "refs/remotes/"),
  };
}

function refsUnder(refs: string[], prefix: string): string[] {
  return refs.flatMap((ref) =>
    ref.startsWith(prefix) ? [ref.slice(prefix.length)] : [],
  );
}

function withoutRemoteName(remoteBranch: string): string {
  return remoteBranch.slice(remoteBranch.indexOf("/") + 1);
}
