// The piece gap check's prompt: it runs once every ticket of a piece spec but the Edit gate has landed or closed, and
// checks only what no review checks, since each drafting ticket's review already checked its Sections against the Outline.
// Its record's schema is ../../recordSchema.ts's, and ../../reviewList.ts turns it into the last review-list comment;
// pieceWorkflow.ts supplies it, and ../../SpecRun/ReviewListPoster.ts launches it with no targets and posts that comment.

import { stepReadLine } from "../../IssueReader.ts";
import {
  addendumLine,
  gapCheckTicketLineOf,
  gapRecordSectionOf,
  sectionOf,
  unattendedRunLine,
} from "../../promptText.ts";
import type { GapCheckPromptInput, GapCheckTicket } from "../../Workflow.ts";

export interface PieceGapCheckPromptInput extends GapCheckPromptInput {
  draftPath: string;
}

export function pieceGapCheckPrompt({
  spec,
  title,
  tickets,
  draftPath,
}: PieceGapCheckPromptInput): string {
  return [
    `You are the gap check of an unattended run on a piece spec. ${unattendedRunLine()}

Every ticket of the piece spec ${spec.repo}#${spec.number}, "${title}", has landed or closed, but the Edit gate, the developer's \`ready-for-human\` ticket to edit the Deliverable. List what the spec asks for that the Agent draft doesn't give. Your working directory is the primary root, on master, where the Agent draft every landed ticket drafted is: \`${draftPath}\`. ${stepReadLine}`,
    sectionOf("What you check", [
      "Check only what no review checks: each drafting ticket's review already checked its Sections against the spec's Outline, Form and the writing rules, so never repeat it.",
      addendumLine,
      "Each User Story is something the spec asks for, and so is each ask of an addendum. Check each against the Agent draft.",
      "Check each ask of the spec no ticket was given, whether no ticket names it or the ticket that did was closed as not planned: a ticket closed as not planned drafted nothing.",
      "Skip what an addendum drops. A Section that gives an ask in other words than the spec's is no gap.",
    ]),
    "Change nothing: no edits, commits, comments or issues, and never read or write the Deliverable's Doc. The runner posts your gaps as the spec's last review list; it never files the drafted follow-ups.",
    gapRecordSectionOf({
      ask: "its story number or the addendum's words",
      followUp: "a drafting ticket",
    }),
    `## The spec's tickets\n\n${tickets.map(ticketLineOf).join("\n")}`,
  ].join("\n\n");
}

function ticketLineOf(ticket: GapCheckTicket): string {
  const line = gapCheckTicketLineOf(ticket);
  return ticket.isOpen ? `${line} (open: the Edit gate)` : line;
}
