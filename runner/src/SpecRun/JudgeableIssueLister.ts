// `runner judgeable`: lists a repo's open issues /judge-findings should take, oldest issue number first, so the skill
// reads one summary instead of a `gh` call per issue. One comment search finds the candidates; each is then read for the
// developer's own review lists, counted by ../reviewList.ts. SpecRun.ts delegates here.

import { isRunnersComment } from "../halts.ts";
import { issueLabelOf, type IssueRef } from "../IssueWorkspaces.ts";
import {
  isReviewList,
  reviewListHeading,
  undecidedCountOf,
} from "../reviewList.ts";
import { SpecRunBase } from "./SpecRunBase.ts";

// What an issue leaves to judge: its undecided items, or none and so its close.
type Judgement = number | "ready to close";

export class JudgeableIssueLister extends SpecRunBase {
  // Resolves to the lines the command prints.
  async judgeable(repo: string): Promise<string> {
    const candidates = await this.config.github.openIssuesCommentedWith(
      repo,
      reviewListHeading,
    );
    const oldestFirst = [...candidates].sort((a, b) => a.number - b.number);
    const lines = await Promise.all(
      oldestFirst.map((issue) => this._lineOf(issue)),
    );
    const listed = lines.flatMap((line) => (line === undefined ? [] : [line]));
    if (listed.length === 0) return `Nothing in ${repo} needs judging.`;
    return listed.join("\n");
  }

  // Undefined where the issue leaves nothing to judge.
  private async _lineOf(issue: IssueRef): Promise<string | undefined> {
    const judgement = await this._judgementOf(issue);
    if (judgement === undefined) return undefined;
    const { title } = await this.config.github.issueOf(issue);
    return `${issueLabelOf(issue)} · "${title}" · ${judgementTextOf(judgement)}`;
  }

  // Only the developer's own review lists count, as `runner decide` and /judge-findings read them.
  private async _judgementOf(issue: IssueRef): Promise<Judgement | undefined> {
    const { github, developer } = this.config;
    const lists = (await github.authoredCommentsOf(issue))
      .filter(
        (comment) =>
          comment.author === developer &&
          isRunnersComment(comment) &&
          isReviewList(comment.body),
      )
      .map(({ body }) => body);
    if (lists.length === 0) return undefined;
    const { items } = undecidedCountOf(lists);
    if (items > 0) return items;
    if (!(await this._isEverySubIssueClosed(issue))) return undefined;
    return "ready to close";
  }

  // A Standalone ticket has no sub-issues, so every item decided is its whole close rule.
  private async _isEverySubIssueClosed(issue: IssueRef): Promise<boolean> {
    const { github } = this.config;
    const subIssues = await Promise.all(
      (await github.subIssuesOf(issue)).map((sub) => github.issueOf(sub)),
    );
    return subIssues.every(({ isOpen }) => !isOpen);
  }
}

function judgementTextOf(judgement: Judgement): string {
  return typeof judgement === "number" ? `${judgement} undecided` : judgement;
}
