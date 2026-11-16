// The piece review step: the prompt that runs a review of a drafting ticket's Agent draft on the spec, standards and
// reader axes, by the implementer in a run or a fresh review session for a session review, following `/review-piece` read
// by its path, the review record it returns: code's, on these axes, plus the overlap hits it judged no copy, and the
// check that it spawned its three reviewer subagents, with the resume that sends back one that didn't.
// pieceWorkflow.ts registers it; ../../SpecRun/ReviewStepper.ts launches it.

import { stepReadLine } from "../../IssueReader.ts";
import {
  codeListOf,
  implementerReviewLineOf,
  reviewerResumePromptOf,
  reviewFindingsText,
  sessionReturnOf,
  sessionReviewLineOf,
} from "../../promptText.ts";
import {
  arraySchema,
  objectSchema,
  reviewRecordSchemaOf,
  stringSchema,
} from "../../recordSchema.ts";
import type { Axis } from "../../verdicts.ts";
import type { ReviewerCheck, ReviewPromptInput } from "../../Workflow.ts";
import { draftingScope } from "./draftingScope.ts";
import { passagesFolderIn } from "./implementStep.ts";

const pieceAxes: Axis[] = ["spec", "standards", "reader"];

export interface PieceReviewPromptInput extends ReviewPromptInput {
  draftPath: string;
}

export function pieceReviewPrompt({
  issue,
  spec,
  title,
  labels,
  skillName,
  branch,
  workspacePath,
  draftPath,
  isSessionReview = false,
}: PieceReviewPromptInput): string {
  const passagesFolder = passagesFolderIn(workspacePath, issue);
  const scope = draftingScope.sectionsOf(labels);
  const ticketKind = " on a piece spec's drafting ticket";
  const opening = isSessionReview
    ? sessionReviewLineOf(ticketKind)
    : implementerReviewLineOf(ticketKind);
  return `${opening}

Read \`.claude/skills/${skillName}/SKILL.md\` and follow it to review ${issue.repo}#${issue.number}, "${title}", on the ${codeListOf(pieceAxes, "and")} axes. It is user-invoked, so read it by that path rather than calling the Skill tool. Your working directory is the ticket's issue workspace root, on the ticket's branch, \`${branch}\`. The draft input is the Agent draft, \`${draftPath}\` in the \`${spec.repo}\` clone, and the passages folder, \`${passagesFolder}\`; the ticket's spec is ${spec.repo}#${spec.number}. The in-scope text is ${scope}. ${stepReadLine}

Change nothing: no edits, commits, comments or fixes. ${sessionReturnOf(["findings", "dismissedOverlaps"])}, the review record:
- ${reviewFindingsText({ axes: pieceAxes, where: "its file:line in the Agent draft, or the spec's Outline line for a reader finding", claim: "what it says, in a line, quoting the sentence" })}
- \`dismissedOverlaps\`: each overlap hit the spec reviewer judged no copy, its \`hit\` as the overlap command printed it and its one-line \`reason\`; empty when it dismissed none.`;
}

// The spec, standards and reader reviewers `/review-piece` spawns. Its diff is the Agent draft alone, so the file count
// would always offer inline review; in the drafter's own session a skipped spawn leaves the drafter checking its own prose.
export function pieceReviewerCheckOf(skillName: string): ReviewerCheck {
  return {
    count: pieceAxes.length,
    resumePrompt: reviewerResumePromptOf(
      `all three, the spec, standards and reader reviewers, as \`.claude/skills/${skillName}/SKILL.md\` says: three Agent calls in one message`,
    ),
    offerInline: false,
  };
}

export const pieceReviewRecordSchema = reviewRecordSchemaOf(pieceAxes, {
  dismissedOverlaps: arraySchema(
    objectSchema({ hit: stringSchema, reason: stringSchema }),
  ),
});
