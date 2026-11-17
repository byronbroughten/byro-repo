// The code Workflow's section of a spec's gap check, which lists what the spec asked for that no landed ticket covered. It belongs to the spec,
// so it launches with no targets, once every Workflow's trigger lets it: ../../promptText/GapCheckPrompt.ts's frame says when, and holds the rules every section shares.
// The record's schema is ../../recordSchema.ts's, and ../../reviewList.ts turns it into the final review-list comment;
// codeWorkflow.ts supplies it, and ../../SpecRun/SpecEndRunner.ts launches it and posts that comment.

import type { GapCheckSection } from "../../Workflow.ts";

export const codeGapCheckSection: GapCheckSection = {
  workflow: "code",
  place: "master",
  checks: [
    "A code ticket's work is on master, in the primary root; a ticket closed as not planned landed nothing.",
  ],
  followUp: "a follow-up issue",
};
