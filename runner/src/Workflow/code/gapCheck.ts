// The code gap check's prompt: it runs once a spec's every ticket is closed, listing what the spec asked for that no
// landed ticket covered. It belongs to the spec, so it launches with no targets.
// Its record's schema is ../../recordSchema.ts's, and ../../reviewList.ts turns it into the final review-list comment;
// codeWorkflow.ts supplies it, and SpecRun/SpecEndRunner.ts launches it and posts that comment.

import { stepReadLine } from "../../IssueReader.ts";
import {
  addendumLine,
  gapCheckTicketLineOf,
  gapRecordSectionOf,
  unattendedRunLine,
} from "../../promptText.ts";
import type { GapCheckPromptInput } from "../../Workflow.ts";

export function gapCheckPrompt({
  spec,
  title,
  tickets,
}: GapCheckPromptInput): string {
  const record = gapRecordSectionOf({
    ask: "its story number or section",
    followUp: "a follow-up issue",
  });
  return `You are the gap check of an unattended run. ${unattendedRunLine()}

Every ticket of the spec ${spec.repo}#${spec.number}, "${title}", is closed. List what the spec asked for that no landed ticket covered. Your working directory is the primary root, on master, where every landed ticket's work is. ${stepReadLine}

## How you check

- ${addendumLine}
- Each User Story and each Implementation Decision is something the spec asked for. Check each one against master and the tickets below; a ticket closed as not planned landed nothing.
- Skip what the spec no longer asks for: the stories of every Phase its \`## Phases\` section, in the body or an addendum, marks \`dropped\`, and every story or section an addendum drops.
- A gap is something the spec still asks for that master doesn't do. A ticket that covers it differently from how the spec words it is no gap.

Change nothing: no edits, commits, comments or issues. The runner posts your gaps; it never files the drafted follow-ups.

${record}

## The spec's tickets

${tickets.map(gapCheckTicketLineOf).join("\n")}`;
}
