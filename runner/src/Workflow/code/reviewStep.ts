// The review step: the prompt that runs a fresh code review of a ticket's branch on both axes, and the review record it returns.
// codeWorkflow.ts supplies it, and SpecRun/ReviewStepper.ts launches it after the implement step; resolve reads its findings.

import { stepReadLine } from "../../IssueReader.ts";
import { reviewFindingsText, unattendedRunLine } from "../../promptText.ts";
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
  pointsWorthChecking = [],
}: ReviewPromptInput): string {
  return [
    `You are the review step of an unattended run. ${unattendedRunLine()}`,
    `Call the Skill tool with "${skillName}" to review ${issue.repo}#${issue.number}, "${title}", on both axes, with \`master\` as the fixed point. Your working directory is the ticket's issue workspace root; these repos are on the ticket's branch, \`${branch}\`: ${branchedRepos.join(", ")}. Review each one's changes. ${stepReadLine}`,
    ...pointsSectionsOf(pointsWorthChecking),
    `Change nothing: no edits, commits, comments or fixes. Return the review record: ${reviewFindingsText({ axes: codeAxes, where: "its file:line or area", claim: "what it says, in a line" })}`,
  ].join("\n\n");
}

// Empty when the implementer named none, so the prompt is the one a session review gets.
function pointsSectionsOf(points: string[]): string[] {
  if (points.length === 0) return [];
  return [
    `## The implementer's points worth checking\n\n${points.map((point) => `- ${point}`).join("\n")}`,
    "These are where the implementer suspects its work is weak, unfinished or easy to get wrong. When you brief the reviewers, paste it into both reviewers' briefs, Standards and Spec alike, as things to check, not as findings: each reviewer reports only what it confirms.",
  ];
}

export const reviewRecordSchema = reviewRecordSchemaOf(codeAxes);
