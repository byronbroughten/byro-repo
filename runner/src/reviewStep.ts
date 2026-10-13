// The review step: the prompt that runs a fresh code review of a ticket's branch on both axes, and the review record it returns.
// SpecRun.ts launches it after the implement step; finding triage (a later ticket) reads its findings.

import type { IssueRef } from "./IssueWorkspaces.ts";

export interface ReviewRecord {
  // Each finding as the review wrote it, in prose; empty when it found nothing.
  findings: string[];
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

Call the Skill tool with "${skillName}" to review ${issue.repo}#${issue.number}, "${title}", on both axes, with \`master\` as the fixed point. Your working directory is the ticket's issue workspace root; these repos are on the ticket's branch, \`${branch}\`: ${branchedRepos.join(", ")}. Review each one's changes.

Change nothing: no edits, commits, comments or fixes. Return the review record: \`findings\`, each finding the review reports as one prose string naming its file:line, or an empty list when it finds nothing.`;
}

export const reviewRecordSchema = {
  type: "object",
  properties: { findings: { type: "array", items: { type: "string" } } },
  required: ["findings"],
  additionalProperties: false,
};
