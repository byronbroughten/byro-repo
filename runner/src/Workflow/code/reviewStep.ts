// The review step: the prompt that runs a fresh code review of a ticket's branch on both axes, and the review record it returns.
// codeWorkflow.ts supplies it, and SpecRun/ReviewStepper.ts launches it after the implement step; resolve reads its findings.

import { stepReadLine } from "../../IssueReader.ts";
import { reviewFindingsText } from "../../promptText.ts";
import { reviewRecordSchemaOf } from "../../recordSchema.ts";
import type { Axis } from "../../verdicts.ts";
import type { ReviewPromptInput } from "../../Workflow.ts";

const codeAxes: Axis[] = ["standards", "spec"];

export function reviewPrompt({
  issue,
  title,
  skillName,
  branch,
  branchedRepos,
}: ReviewPromptInput): string {
  return `You are the review step of an unattended run. Nobody is watching this session: never ask a question or wait for an answer.

Call the Skill tool with "${skillName}" to review ${issue.repo}#${issue.number}, "${title}", on both axes, with \`master\` as the fixed point. Your working directory is the ticket's issue workspace root; these repos are on the ticket's branch, \`${branch}\`: ${branchedRepos.join(", ")}. Review each one's changes. ${stepReadLine}

Change nothing: no edits, commits, comments or fixes. Return the review record: ${reviewFindingsText({ axes: codeAxes, where: "its file:line or area", claim: "what it says, in a line" })}`;
}

export const reviewRecordSchema = reviewRecordSchemaOf(codeAxes);
