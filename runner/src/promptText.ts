// Wording shared by the agent-step prompts and the comments the runner posts.

import { issueRef } from "./IssueWorkspaces.ts";
import { type Axis, verdicts } from "./verdicts.ts";
import type { GapCheckTicket } from "./Workflow.ts";

// A string for the placeholder a generated skill names a number by, such as `<n>`.
export type NumberOrPlaceholder = number | string;

// The implement and resolve steps' write scope; the why is in byro-repo's docs/claude-code-guardrails.md.
export const stepWriteLine =
  "You may do what the tier list allows in your workspace. Use `git -C <dir>` rather than `cd <dir> && git`. When a write is denied, record one `denied-tool` blocker instead of trying a workaround. A refused read whose answer you got another way, or didn't need, is not a blocker: name it in your closing comment instead.";

// Said up front, so a step words its message right before byro-repo's commit-msg hook refuses it.
export const commitMessageLine =
  "In a commit message, never put a closing keyword (`close`, `fix`, `resolve` or one of their forms) before an issue reference: GitHub would close the issue once the commit reaches master. Write `review of #512` or `for #512` instead.";

// Every step prompt tells its session no one will answer.
export function unattendedRunLine(): string {
  return "Nobody is watching this session: never ask a question or wait for an answer.";
}

export function codeListOf(
  words: readonly string[],
  conjunction: "or" | "and" = "or",
): string {
  const quoted = words.map((word) => `\`${word}\``);
  if (quoted.length < 2) return quoted.join("");
  return `${quoted.slice(0, -1).join(", ")} ${conjunction} ${quoted.at(-1)}`;
}

// A step of the implementer's session launches with every session step's schema under `output`, so it names its own fields (#741).
export function sessionReturnOf(fields: readonly string[]): string {
  return `Return \`output\` holding only ${codeListOf(fields, "and")}`;
}

export interface ReviewFindingsWording {
  // The reviewers' order, which the findings keep.
  axes: readonly Axis[];
  where: string;
  claim: string;
}

// The review record's `findings` field, as every Workflow's review prompt words it.
export function reviewFindingsText({
  axes,
  where,
  claim,
}: ReviewFindingsWording): string {
  const [first, ...rest] = axes.map((axis) => `the ${axis} reviewer's`);
  const order = [`${first} findings`, ...rest].join(", then ");
  return `\`findings\`, an empty list when the review finds nothing. List ${order}, each in its reviewer's order, never merged or reranked. Carry every finding a reviewer reports, each as its reviewer worded it, even one you would dismiss: judging a finding is the resolve step's job, through its Dismiss. Each finding has \`axis\` (${codeListOf(axes)}, its reviewer's), \`where\` (${where}), \`claim\` (${claim}), \`suggestedVerdict\` (${codeListOf(verdicts)}, as its reviewer suggested) and \`reason\` (the reviewer's reason for that verdict).`;
}

// Where an interactive session writes its review record, and the `runner review` call that submits it.
export interface SessionSubmit {
  recordPath: string;
  command: string;
}

// How a review prompt opens and how its record goes back, the one place a run's review and a session's brief differ.
export interface ReviewFraming {
  opening: string;
  returnLineOf(fields: readonly string[]): string;
}

// Absent `sessionSubmit`, the review is a run's, by its resumed implementer.
export function reviewFramingOf(
  sessionSubmit: SessionSubmit | undefined,
  ticketKind = "",
): ReviewFraming {
  if (sessionSubmit === undefined) return runReviewFramingOf(ticketKind);
  return sessionReviewFramingOf(sessionSubmit, ticketKind);
}

// A run's review resumes the implementer, so it reviews its own work and returns the record under `output`.
function runReviewFramingOf(ticketKind: string): ReviewFraming {
  return {
    opening: `You implemented this ticket, and you now run its review step in an unattended run${ticketKind}: you orchestrate the review of your own work, briefing the reviewer subagents, who start fresh, and returning their findings. ${unattendedRunLine()}`,
    returnLineOf(fields) {
      return `Change nothing: no edits, commits, comments or fixes. ${sessionReturnOf(fields)}, the review record:`;
    },
  };
}

// A session has no committed implement record, so its opening asks it to name its own points worth checking.
function sessionReviewFramingOf(
  { recordPath, command }: SessionSubmit,
  ticketKind: string,
): ReviewFraming {
  return {
    opening: `You implemented this ticket in this interactive session, and you now run its review${ticketKind}, as a run's review step does: you orchestrate the review of your own work, briefing the reviewer subagents, who start fresh, and recording their findings.\n\nYou have no committed implement record, so the points worth checking are yours to name: list where you suspect your work is weak, unfinished or easy to get wrong, and paste them into every reviewer's brief as things to check, not as findings: each reviewer reports only what it confirms.`,
    returnLineOf(fields) {
      return `Change nothing but the record's file: no edits, commits, comments or fixes. Write the review record to \`${recordPath}\`, a JSON object holding only ${codeListOf(fields, "and")}, then submit it with \`${command}\`, taking the id from the \`session: <id>\` line in your context. The review record:`;
    },
  };
}

// The resume a review that skipped its reviewer subagents is sent back with; `spawn` names them, how and how many.
export function reviewerResumePromptOf(spawn: string): string {
  return `Your review ran without its reviewer subagents. Spawn ${spawn}. Then return the review record from their reports, replacing the one you returned.`;
}

// Every Workflow's gap check reads it first.
export const addendumLine =
  "Read the spec's body and its comments: an addendum the developer posted as a comment changes the spec.";

export interface GapRecordWording {
  // How a gap names its ask, after "by".
  ask: string;
  // What the drafted title would be, after "the title of".
  followUp: string;
}

// The gap-check record's section, as every Workflow's gap-check prompt words it.
export function gapRecordSectionOf({
  ask,
  followUp,
}: GapRecordWording): string {
  return `## The record\n\nReturn \`gaps\`, one per gap, or an empty list when you find none: \`ask\` (what the spec asked for, by ${ask}), \`evidence\` (what you checked and found missing), \`recommendation\` (what you recommend the developer do) and \`draftIssueTitle\` (the title of ${followUp} that would close it).`;
}

export function gapCheckTicketLineOf({ issue, title }: GapCheckTicket): string {
  return `- ${issueRef.labelOf(issue)}, "${title}"`;
}

// A list that follows a label's colon on the label's line, or ` none`.
export function bulletsOf(items: string[]): string {
  if (items.length === 0) return " none";
  return items.map((item) => `\n- ${item}`).join("");
}

export function sectionOf(heading: string, bullets: string[]): string {
  return `## ${heading}\n\n${bulletListOf(bullets)}`;
}

export function bulletListOf(bullets: readonly string[]): string {
  return bullets.map((bullet) => `- ${bullet}`).join("\n");
}
