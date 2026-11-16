// The review step: the prompt that runs a code review of a ticket's branch on both axes, by the implementer in a run or
// an interactive session from its brief, the review record it returns, and the check that it spawned its two reviewer
// subagents, with the resume that sends back one that didn't.
// codeWorkflow.ts supplies it; SpecRun/ReviewStepper.ts launches it after the implement step, and SpecRun/SessionReviewer.ts
// prints it as a session's brief; resolve reads its findings.

import { stepReadLine } from "../../IssueReader.ts";
import {
  reviewerResumePromptOf,
  reviewFindingsText,
  reviewFramingOf,
} from "../../promptText.ts";
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
  sessionSubmit,
  pointsWorthChecking = [],
}: ReviewPromptInput): string {
  const framing = reviewFramingOf(sessionSubmit);
  return [
    framing.opening,
    `Call the Skill tool with "${skillName}" to review ${issue.repo}#${issue.number}, "${title}", on both axes, with \`master\` as the fixed point. Your working directory is the ticket's issue workspace root; these repos are on the ticket's branch, \`${branch}\`: ${branchedRepos.join(", ")}. Review each one's changes. ${stepReadLine}`,
    ...(isInlineAllowed ? [inlineLine] : []),
    ...pointsSectionsOf(pointsWorthChecking),
    `${framing.returnLineOf(["findings"])} ${reviewFindingsText({ axes: codeAxes, where: "its file:line or area", claim: "what it says, in a line" })}`,
  ].join("\n\n");
}

// Empty when the implementer named none, as for a session's brief, which has no implement record.
function pointsSectionsOf(points: string[]): string[] {
  if (points.length === 0) return [];
  return [
    `## The implementer's points worth checking\n\n${points.map((point) => `- ${point}`).join("\n")}`,
    "These are where the implementer suspects its work is weak, unfinished or easy to get wrong. When you brief the reviewers, paste it into both reviewers' briefs, Standards and Spec alike, as things to check, not as findings: each reviewer reports only what it confirms.",
  ];
}

// A diff this small doesn't need two reviewers, so the step may review on both axes itself.
const inlineLine =
  "The diff is small enough that you may review it inline: you may work through both axes yourself rather than spawn the reviewer subagents.";

// The Standards and Spec reviewers `/code-review` spawns; a review over the inline size that spawns fewer is sent back once.
export function reviewerCheckOf(skillName: string): ReviewerCheck {
  return {
    count: codeAxes.length,
    resumePrompt: reviewerResumePromptOf(
      `both, the Standards and Spec reviewers, as the "${skillName}" skill says: two Agent calls in one message`,
    ),
    offerInline: true,
  };
}

export const reviewRecordSchema = reviewRecordSchemaOf(codeAxes);
