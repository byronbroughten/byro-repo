// The review step: the prompt that runs a fresh code review of a ticket's branch on both axes, the review record it returns,
// and the check that it spawned its two reviewer subagents, with the resume that sends back one that didn't.
// codeWorkflow.ts supplies it, and SpecRun/ReviewStepper.ts launches it after the implement step; resolve reads its findings.

import { stepReadLine } from "../../IssueReader.ts";
import { reviewFindingsText, unattendedRunLine } from "../../promptText.ts";
import { reviewRecordSchemaOf } from "../../recordSchema.ts";
import type { Axis } from "../../verdicts.ts";
import type { ReviewerCheck, ReviewPromptInput } from "../../Workflow.ts";

const codeAxes: Axis[] = ["standards", "spec"];

export function reviewPrompt({
  issue,
  title,
  skillName,
  branch,
  branchedRepos,
  isInlineAllowed,
}: ReviewPromptInput): string {
  return `You are the review step of an unattended run. ${unattendedRunLine()}

Call the Skill tool with "${skillName}" to review ${issue.repo}#${issue.number}, "${title}", on both axes, with \`master\` as the fixed point. Your working directory is the ticket's issue workspace root; these repos are on the ticket's branch, \`${branch}\`: ${branchedRepos.join(", ")}. Review each one's changes. ${stepReadLine}${isInlineAllowed ? `\n\n${inlineLine}` : ""}

Change nothing: no edits, commits, comments or fixes. Return the review record: ${reviewFindingsText({ axes: codeAxes, where: "its file:line or area", claim: "what it says, in a line" })}`;
}

// A diff this small doesn't need two reviewers, so the step may review on both axes itself.
const inlineLine =
  "The diff is small enough that you may review it inline: you may work through both axes yourself rather than spawn the reviewer subagents.";

// The Standards and Spec reviewers `/code-review` spawns; a review over the inline size that spawns fewer is sent back once.
export function reviewerCheckOf(skillName: string): ReviewerCheck {
  return {
    count: codeAxes.length,
    resumePrompt: `Your review ran without its reviewer subagents. Spawn both, the Standards and Spec reviewers, as the "${skillName}" skill says: two Agent calls in one message. Then return the review record from their reports, replacing the one you returned.`,
  };
}

export const reviewRecordSchema = reviewRecordSchemaOf(codeAxes);
