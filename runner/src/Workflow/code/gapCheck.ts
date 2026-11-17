// The code Workflow's section of a spec's gap check, which runs once a spec's every ticket is closed, listing what the spec asked for that no
// landed ticket covered. It belongs to the spec, so it launches with no targets.
// ../../promptText.ts's gapCheckPromptOf frames it with every other section the spec's tickets use; the record's schema is ../../recordSchema.ts's,
// and ../../reviewList.ts turns it into the final review-list comment; codeWorkflow.ts supplies it, and SpecRun/SpecEndRunner.ts launches it and posts that comment.

import type { GapCheckSection } from "../../Workflow.ts";

export const codeGapCheckSection: GapCheckSection = {
  workflow: "code",
  place: "master",
  checks: [
    "A code ticket's work is on master, in the primary root.",
    "Check each story against master and the code tickets below; a ticket closed as not planned landed nothing.",
    "A gap there is something the spec still asks for that master doesn't do.",
  ],
  followUp: "a follow-up issue",
};
