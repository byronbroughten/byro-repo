// `runner decide`: records one review-list item as decided or handled, so a Supervisor or a /judge-findings session
// never hand-edits the comment. It edits only the developer's own review lists, re-fetching the comment just before.
// The edit itself is ../reviewList.ts's; SpecRun.ts delegates here.

import { issueLabelOf, type IssueRef } from "../IssueWorkspaces.ts";
import {
  decidedListOf,
  type ItemDecision,
  reviewListHoldingOf,
} from "../reviewList.ts";
import { SpecRunBase } from "./SpecRunBase.ts";

export class ReviewItemDecider extends SpecRunBase {
  // Resolves to the line the command prints.
  async decide(spec: IssueRef, decision: ItemDecision): Promise<string> {
    const { github, developer } = this.config;
    const { itemId } = decision;
    const found = reviewListHoldingOf(
      await github.authoredCommentsOf(spec),
      developer,
      itemId,
    );
    // The developer may tick boxes on their phone meanwhile, so the edit starts from the latest body.
    const latest = (await github.authoredCommentsOf(spec)).filter(
      ({ id }) => id === found.id,
    );
    const comment = reviewListHoldingOf(latest, developer, itemId);
    await github.editComment(
      comment.id,
      decidedListOf({ body: comment.body, ...decision }),
    );
    return `${itemId} ${decision.kind} on ${issueLabelOf(spec)}.`;
  }
}
