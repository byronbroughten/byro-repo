// The gap check: the prompt that runs once a spec's every ticket is closed, listing what the spec asked for that no
// landed ticket covered, and the gap-check record it returns. It belongs to the spec, so it launches with no targets.
// reviewList.ts turns its record into the final review-list comment; SpecRun.ts launches it and posts that comment.

import { stepReadLine } from "./IssueReader.ts";
import { issueLabelOf, type IssueRef } from "./IssueWorkspaces.ts";
import { arraySchema, objectSchema, stringSchema } from "./recordSchema.ts";

export interface Gap {
  // What the spec asked for, by its story number or section.
  ask: string;
  evidence: string;
  recommendation: string;
  // The drafted follow-up; the runner never files it.
  draftIssueTitle: string;
}

export interface GapCheckRecord {
  gaps: Gap[];
}

export interface GapCheckTicket {
  issue: IssueRef;
  title: string;
}

export interface GapCheckPromptInput {
  spec: IssueRef;
  title: string;
  // Every ticket of the spec, each closed, whether landed or closed as not planned.
  tickets: GapCheckTicket[];
}

export function gapCheckPrompt({
  spec,
  title,
  tickets,
}: GapCheckPromptInput): string {
  const ticketLines = tickets.map(
    ({ issue, title: ticketTitle }) =>
      `- ${issueLabelOf(issue)}, "${ticketTitle}"`,
  );
  return `You are the gap check of an unattended run. Nobody is watching this session: never ask a question or wait for an answer.

Every ticket of the spec ${spec.repo}#${spec.number}, "${title}", is closed. List what the spec asked for that no landed ticket covered. Your working directory is the primary root, on master, where every landed ticket's work is. ${stepReadLine}

## How you check

- Read the spec's body and its comments: an addendum the developer posted as a comment changes the spec.
- Each User Story and each Implementation Decision is something the spec asked for. Check each one against master and the tickets below; a ticket closed as not planned landed nothing.
- Skip what the spec no longer asks for: the stories of every Phase its \`## Phases\` section, in the body or an addendum, marks \`dropped\`, and every story or section an addendum drops.
- A gap is something the spec still asks for that master doesn't do. A ticket that covers it differently from how the spec words it is no gap.

Change nothing: no edits, commits, comments or issues. The runner posts your gaps; it never files the drafted follow-ups.

## The record

Return \`gaps\`, one per gap, or an empty list when you find none: \`ask\` (what the spec asked for, by its story number or section), \`evidence\` (what you checked and found missing), \`recommendation\` (what you recommend the developer do) and \`draftIssueTitle\` (the title of a follow-up issue that would close it).

## The spec's tickets

${ticketLines.join("\n")}`;
}

export const gapCheckOutputSchema = objectSchema({
  gaps: arraySchema(
    objectSchema({
      ask: stringSchema,
      evidence: stringSchema,
      recommendation: stringSchema,
      draftIssueTitle: stringSchema,
    }),
  ),
});

export function gapCheckRecordOf(output: unknown): GapCheckRecord {
  return output as GapCheckRecord;
}
