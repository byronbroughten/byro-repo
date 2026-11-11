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

export function codeListOf(
  words: readonly string[],
  conjunction: "or" | "and" = "or",
): string {
  const quoted = words.map((word) => `\`${word}\``);
  if (quoted.length < 2) return quoted.join("");
  return `${quoted.slice(0, -1).join(", ")} ${conjunction} ${quoted.at(-1)}`;
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
  return `\`findings\`, an empty list when the review finds nothing. List ${order}, each in its reviewer's order, never merged or reranked. Each finding has \`axis\` (${codeListOf(axes)}, its reviewer's), \`where\` (${where}), \`claim\` (${claim}), \`suggestedVerdict\` (${codeListOf(verdicts)}, as its reviewer suggested) and \`reason\` (the reviewer's reason for that verdict).`;
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
  return `## ${heading}\n\n${bullets.map((bullet) => `- ${bullet}`).join("\n")}`;
}
