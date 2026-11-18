// `runner decide`: records one review-list item as decided or handled, so a Supervisor or a /judge-findings session
// never hand-edits the comment. It edits only the developer's own review lists, re-fetching the comment just before.
// A decided Proposal also files a Friction note, through ../frictionNotes.ts, for process revision.
// The edit itself is ../reviewList.ts's; SpecRun.ts delegates here.

import { messageOf } from "../failureText.ts";
import {
  frictionFolderOf,
  noteDateOf,
  writeFrictionNote,
} from "../frictionNotes.ts";
import { type IssueRef, issueRef } from "../IssueWorkspaces.ts";
import {
  decidedListOf,
  decisionLabels,
  type ItemDecision,
  proposalHeadingOf,
  reviewListHoldingOf,
} from "../reviewList.ts";
import { specWorkflowNameOf } from "../Workflow.ts";
import { SpecRunBase } from "./SpecRunBase.ts";

interface DecidedProposal {
  spec: IssueRef;
  decision: ItemDecision;
  heading: string;
}

export class ReviewItemDecider extends SpecRunBase {
  // Resolves to the line the command prints, and a failed note's line after it.
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
    const line = `${itemId} ${decision.kind} on ${issueRef.labelOf(spec)}.`;
    const heading = proposalHeadingOf(comment.body, itemId);
    if (decision.kind !== "decided" || heading === undefined) return line;
    // The decision is already recorded, so a failed note is reported, never undoing it.
    try {
      await this._fileNote({ spec, decision, heading });
      return line;
    } catch (error) {
      return `${line}\nThe Friction note failed: ${messageOf(error)}`;
    }
  }

  private async _fileNote({
    spec,
    decision,
    heading,
  }: DecidedProposal): Promise<void> {
    const labels = await this.config.github.labelsOf(spec);
    writeFrictionNote(frictionFolderOf(this.config.stateFolder), {
      date: noteDateOf(this.config.clock.now()),
      session: this.config.sessionId ?? "",
      workflow: specWorkflowNameOf({ labels }),
      filedBy: "judge-findings",
      source: `${spec.repo}#${spec.number} ${decision.itemId}`,
      status: "",
      body: `${heading}\n\n${decisionLabels.decided}: ${decision.text}`,
    });
  }
}
