// `runner judgeable`: lists a repo's open issues /judge-findings should take, oldest issue number first, so the skill
// reads one summary instead of a `gh` call per issue. One comment search finds the candidates; each is then judged by
// SpecRunBase.ts's _judgementOf, which a run's end shares. SpecRun.ts delegates here.

import { type IssueRef, issueRef } from "../IssueWorkspaces.ts";
import { reviewListHeading } from "../reviewList.ts";
import { runText } from "./runState/runText.ts";
import { SpecRunBase } from "./SpecRunBase.ts";

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
    return `${issueRef.labelOf(issue)} · "${title}" · ${runText.judgementOf(judgement)}`;
  }
}
