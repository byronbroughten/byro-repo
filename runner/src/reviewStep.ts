// The review step: the prompt that runs a fresh code review of a ticket's branch on both axes, and the review record it returns.
// SpecRun.ts launches it after the implement step; finding triage reads its findings.

import { stepReadLine } from "./IssueReader.ts";
import type { IssueRef } from "./IssueWorkspaces.ts";
import { stringSchema } from "./recordSchema.ts";
import { axes, type Axis, type Verdict, verdicts } from "./verdicts.ts";

export interface ReviewFinding {
  axis: Axis;
  where: string;
  claim: string;
  suggestedVerdict: Verdict;
  reason: string;
}

// A run state saved before #362 holds each finding as one prose string.
export type Finding = ReviewFinding | string;

export interface ReviewRecord {
  // Each reviewer's findings in its own order, standards then spec; empty when it found nothing.
  findings: ReviewFinding[];
}

export interface ReviewPromptInput {
  issue: IssueRef;
  title: string;
  skillName: string;
  branch: string;
  branchedRepos: string[];
}

export function reviewPrompt({
  issue,
  title,
  skillName,
  branch,
  branchedRepos,
}: ReviewPromptInput): string {
  return `You are the review step of an unattended run. Nobody is watching this session: never ask a question or wait for an answer.

Call the Skill tool with "${skillName}" to review ${issue.repo}#${issue.number}, "${title}", on both axes, with \`master\` as the fixed point. Your working directory is the ticket's issue workspace root; these repos are on the ticket's branch, \`${branch}\`: ${branchedRepos.join(", ")}. Review each one's changes. ${stepReadLine}

Change nothing: no edits, commits, comments or fixes. Return the review record: \`findings\`, an empty list when the review finds nothing. List the standards reviewer's findings, then the spec reviewer's, each in its reviewer's order, never merged or reranked. Each finding has \`axis\` (\`standards\` or \`spec\`, its reviewer's), \`where\` (its file:line or area), \`claim\` (what it says, in a line), \`suggestedVerdict\` (\`dismiss\`, \`fix\`, \`propose\` or \`halt\`, as its reviewer suggested) and \`reason\` (the reviewer's reason for that verdict).`;
}

export const reviewFindingSchema = {
  type: "object",
  properties: {
    axis: { enum: axes },
    where: stringSchema,
    claim: stringSchema,
    suggestedVerdict: { enum: verdicts },
    reason: stringSchema,
  },
  required: ["axis", "where", "claim", "suggestedVerdict", "reason"],
  additionalProperties: false,
};

export const reviewRecordSchema = {
  type: "object",
  properties: { findings: { type: "array", items: reviewFindingSchema } },
  required: ["findings"],
  additionalProperties: false,
};
