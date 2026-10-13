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

export class GhCli implements WrapUpGitHub {
  private readonly owner: string;

  constructor(owner: string) {
    this.owner = owner;
  }

  async closeIssue({ repo, number }: IssueRef, comment: string): Promise<void> {
    await this._gh(
      "issue",
      "close",
      String(number),
      "-R",
      `${this.owner}/${repo}`,
      "--comment",
      comment,
    );
  }

  // GitHub answers 404 for an issue with no parent.
  async parentOf({ repo, number }: IssueRef): Promise<ParentIssue | undefined> {
    let output: string;
    try {
      output = await this._gh(
        "api",
        `repos/${this.owner}/${repo}/issues/${number}/parent`,
      );
    } catch (error) {
      if (String((error as { stderr?: unknown }).stderr).includes("HTTP 404")) {
        return undefined;
      }
      throw error;
    }
    return parentOf(JSON.parse(output) as RawParent);
  }

  private async _gh(...args: string[]): Promise<string> {
    const { stdout } = await execFileAsync("gh", args);
    return stdout;
  }
}

function parentOf(raw: RawParent): ParentIssue {
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
