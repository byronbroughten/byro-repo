// Closes a landed ticket's issue, or leaves a Standalone one open, and reads its parent, spec and handoff sessions.

import type { GitHubWrite, WrapUpFacts } from "../FactsFile.ts";
import { issueLabelOf, type IssueRef } from "../IssueWorkspaces.ts";
import {
  developersReviewListsOf,
  reviewListMarkOf,
  undecidedCountOf,
} from "../reviewList.ts";
import { handoffSessionIdOf } from "../transcriptFacts.ts";
import { WrapUpFailure } from "../WrapUpFailure.ts";
import { WrapUpBase } from "./WrapUpBase.ts";
import { labels, type ParentCheck, type ParentIssue } from "./wrapUpTypes.ts";

export class IssueCloser extends WrapUpBase {
  // A Standalone ticket is its own spec, so every Propose on it is decided before it closes.
  async _close(issue: IssueRef, facts: WrapUpFacts): Promise<boolean> {
    const isLeftOpen =
      (await this._isStandalone(issue)) &&
      (await this._hasUndecidedReviewItems(issue, facts));
    if (isLeftOpen) {
      this._log(leftOpenLineOf(issue));
      return true;
    }
    await this._withRetries(`Closing #${issue.number}`, () =>
      this.config.github.closeIssue(issue, closingCommentOf(facts)),
    );
    return false;
  }

  // No parent spec and no sub-issues.
  private async _isStandalone(issue: IssueRef): Promise<boolean> {
    if ((await this._parentOf(issue)) !== undefined) return false;
    const subIssues = await this._withRetries(
      `Reading ${issueLabelOf(issue)}'s sub-issues`,
      () => this.config.github.subIssuesOf(issue),
    );
    return subIssues.length === 0;
  }

  // A run posts its list only after wrap-up, so until this ticket's is posted the facts stand in for it.
  private async _hasUndecidedReviewItems(
    issue: IssueRef,
    facts: WrapUpFacts,
  ): Promise<boolean> {
    const comments = await this._withRetries(
      `Reading ${issueLabelOf(issue)}'s comments`,
      () => this.config.github.authoredCommentsOf(issue),
    );
    const lists = developersReviewListsOf(comments, this.config.developer);
    const mark = reviewListMarkOf(issue);
    if (!lists.some((body) => body.includes(mark))) {
      return facts.hasUndecidedReviewItems === true;
    }
    return undecidedCountOf(lists).items > 0;
  }

  async _checkParent(issue: IssueRef): Promise<ParentCheck> {
    return parentCheckOf(await this._parentOf(issue));
  }

  async _handoffSessionIdsOf(issue: IssueRef): Promise<string[]> {
    const comments = await this._withRetries(
      `Reading ${issueLabelOf(issue)}'s comments`,
      () => this.config.github.commentsOf(issue),
    );
    return comments.flatMap((comment) => {
      const sessionId = handoffSessionIdOf(comment);
      return sessionId === undefined ? [] : [sessionId];
    });
  }

  async _specOf(issue: IssueRef): Promise<IssueRef> {
    return (await this._parentOf(issue))?.issue ?? issue;
  }

  private async _parentOf(issue: IssueRef): Promise<ParentIssue | undefined> {
    return this._withRetries(`Reading ${issueLabelOf(issue)}'s parent`, () =>
      this.config.github.parentOf(issue),
    );
  }
}

// The wrap-up log and the CLI's result line alike.
export function leftOpenLineOf(issue: IssueRef): string {
  return `${issueLabelOf(issue)} stays open: its review list has undecided items, and /judge-findings closes it once they're decided.`;
}

function closingCommentOf({
  closingComment,
  boxesUndone = [],
  githubWrites = [],
}: WrapUpFacts): string {
  const parts = [closingComment];
  if (githubWrites.length > 0) {
    parts.push("", "GitHub writes:", ...githubWrites.map(gitHubWriteLineOf));
  }
  if (boxesUndone.length > 0) {
    const undone = boxesUndone.map(({ box, reason }) => `- ${box}: ${reason}`);
    parts.push("", "Left undone:", ...undone);
  }
  return parts.join("\n");
}

function gitHubWriteLineOf({
  issue,
  action,
  url,
  summary,
}: GitHubWrite): string {
  const preposition = action === "comment" ? "on" : "of";
  return `- ${action} ${preposition} ${issue}: ${summary} ${url}`;
}

function parentCheckOf(parent: ParentIssue | undefined): ParentCheck {
  if (parent === undefined) return { kind: "none" };
  if (parent.labels.includes(labels.map)) {
    return { kind: "map", parent: parent.issue };
  }
  if (parent.subIssues === undefined) {
    throw new WrapUpFailure(
      "parent-check",
      `${issueLabelOf(parent.issue)}'s sub-issue summary could not be read`,
    );
  }
  if (parent.subIssues.completed < parent.subIssues.total) {
    return { kind: "open-sub-issues", parent: parent.issue };
  }
  return { kind: "ready-to-close", parent: parent.issue };
}
