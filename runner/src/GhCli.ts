// The wrap-up's GitHub port over the `gh` CLI. WrapUp.ts retries each call; this only maps gh's output.

import { execFile } from "node:child_process";
import { promisify } from "node:util";

import type { IssueRef } from "./IssueWorkspaces.ts";
import type { ParentIssue, WrapUpGitHub } from "./WrapUp.ts";

const execFileAsync = promisify(execFile);

interface RawParent {
  number?: unknown;
  repository_url?: unknown;
  labels?: { name?: unknown }[];
  sub_issues_summary?: { total?: unknown; completed?: unknown };
}

interface RawComments {
  comments?: { body?: unknown }[];
}

export class GhCli implements WrapUpGitHub {
  private readonly owner: string;

  constructor(owner: string) {
    this.owner = owner;
  }

  async closeIssue({ repo, number }: IssueRef, comment: string): Promise<void> {
    await gh(
      "issue",
      "close",
      String(number),
      "-R",
      `${this.owner}/${repo}`,
      "--comment",
      comment,
    );
  }

  async commentsOf({ repo, number }: IssueRef): Promise<string[]> {
    const output = await gh(
      "issue",
      "view",
      String(number),
      "-R",
      `${this.owner}/${repo}`,
      "--json",
      "comments",
    );
    const { comments } = JSON.parse(output) as RawComments;
    return (comments ?? []).flatMap(({ body }) =>
      typeof body === "string" ? [body] : [],
    );
  }

  // GitHub answers 404 for an issue with no parent.
  async parentOf({ repo, number }: IssueRef): Promise<ParentIssue | undefined> {
    let output: string;
    try {
      output = await gh(
        "api",
        `repos/${this.owner}/${repo}/issues/${number}/parent`,
      );
    } catch (error) {
      if (String((error as { stderr?: unknown }).stderr).includes("HTTP 404")) {
        return undefined;
      }
      throw error;
    }
    return parentIssueOf(JSON.parse(output) as RawParent);
  }
}

async function gh(...args: string[]): Promise<string> {
  const { stdout } = await execFileAsync("gh", args);
  return stdout;
}

function parentIssueOf(raw: RawParent): ParentIssue {
  const repo = String(raw.repository_url).split("/").at(-1) ?? "";
  const { total, completed } = raw.sub_issues_summary ?? {};
  return {
    issue: { repo, number: Number(raw.number) },
    labels: (raw.labels ?? []).map((label) => String(label.name)),
    subIssues:
      typeof total === "number" && typeof completed === "number"
        ? { total, completed }
        : undefined,
  };
}
