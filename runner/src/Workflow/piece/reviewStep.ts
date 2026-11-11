// The piece review step: the prompt that runs a fresh review of a drafting ticket's Agent draft on the spec, standards
// and reader axes, following `/review-piece` read by its path, and the review record it returns: code's, on these axes,
// plus the overlap hits it judged no copy. pieceWorkflow.ts registers it; ../../SpecRun/ReviewStepper.ts launches it.

import { stepReadLine } from "../../IssueReader.ts";
import {
  codeListOf,
  reviewFindingsText,
  unattendedRunLine,
} from "../../promptText.ts";
import {
  arraySchema,
  objectSchema,
  reviewRecordSchemaOf,
  stringSchema,
} from "../../recordSchema.ts";
import type { Axis } from "../../verdicts.ts";
import type { ReviewPromptInput } from "../../Workflow.ts";
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
}: PieceReviewPromptInput): string {
  const passagesFolder = passagesFolderIn(workspacePath, issue);
  const scope = draftingScope.sectionsOf(labels);
  return `You are the review step of an unattended run on a piece spec's drafting ticket. ${unattendedRunLine()}

Read \`.claude/skills/${skillName}/SKILL.md\` and follow it to review ${issue.repo}#${issue.number}, "${title}", on the ${codeListOf(pieceAxes, "and")} axes. It is user-invoked, so read it by that path rather than calling the Skill tool. Your working directory is the ticket's issue workspace root, on the ticket's branch, \`${branch}\`. The draft input is the Agent draft, \`${draftPath}\` in the \`${spec.repo}\` clone, and the passages folder, \`${passagesFolder}\`; the ticket's spec is ${spec.repo}#${spec.number}. The in-scope text is ${scope}. ${stepReadLine}

Change nothing: no edits, commits, comments or fixes. Return the review record:
- ${reviewFindingsText({ axes: pieceAxes, where: "its file:line in the Agent draft, or the spec's Outline line for a reader finding", claim: "what it says, in a line, quoting the sentence" })}
- \`dismissedOverlaps\`: each overlap hit the spec reviewer judged no copy, its \`hit\` as the overlap command printed it and its one-line \`reason\`; empty when it dismissed none.`;
}

export const pieceReviewRecordSchema = reviewRecordSchemaOf(pieceAxes, {
  dismissedOverlaps: arraySchema(
    objectSchema({ hit: stringSchema, reason: stringSchema }),
  ),
});
