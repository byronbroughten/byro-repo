// `runner judgeable`: lists a repo's open issues /judge-findings should take, oldest issue number first, so the skill
// reads one summary instead of a `gh` call per issue. One comment search finds the candidates; each is then judged by
// SpecRunBase.ts's _judgementOf, which a run's end shares. SpecRun.ts delegates here.

import { type IssueRef, issueRef } from "../IssueWorkspaces.ts";
import { reviewListHeading } from "../reviewList.ts";
import type { Judgement } from "./runState.ts";
import { runText } from "./runState/runText.ts";
import { SpecRunBase } from "./SpecRunBase.ts";

export class JudgeableIssueLister extends SpecRunBase {
  // Resolves to the lines the command prints.
  async judgeable(repo: string): Promise<string> {
    const judged = await this._judgedIssuesOf(repo);
    if (judged.length === 0) return this.nothingLineOf(repo);
    const lines = await Promise.all(
      judged.map((judgedIssue) => this._lineOf(judgedIssue)),
    );
    return lines.join("\n");
  }

  // The issues `judgeable` lists, in its order, for `runner judge-brief all`.
  async judgeableIssuesOf(repo: string): Promise<IssueRef[]> {
    const judged = await this._judgedIssuesOf(repo);
    return judged.map(({ issue }) => issue);
  }

  nothingLineOf(repo: string): string {
    return `Nothing in ${repo} needs judging.`;
  }

  private async _judgedIssuesOf(repo: string): Promise<JudgedIssue[]> {
    const candidates = await this.config.github.openIssuesCommentedWith(
      repo,
      reviewListHeading,
    );
    const oldestFirst = [...candidates].sort((a, b) => a.number - b.number);
    const judged = await Promise.all(
      oldestFirst.map(async (issue) => ({
        issue,
        judgement: await this._judgementOf(issue),
      })),
    );
    return judged.flatMap(({ issue, judgement }) =>
      judgement === undefined ? [] : [{ issue, judgement }],
    );
  }

  private async _lineOf({ issue, judgement }: JudgedIssue): Promise<string> {
    const { title } = await this.config.github.issueOf(issue);
    return `${issueRef.labelOf(issue)} · "${title}" · ${runText.judgementOf(judgement)}`;
  }
}

interface JudgedIssue {
  issue: IssueRef;
  judgement: Judgement;
}
