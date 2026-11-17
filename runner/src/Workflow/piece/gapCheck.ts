// The piece Workflow's section of a spec's gap check, which runs once every ticket of the spec but the Edit gate has landed or closed, and
// checks the Agent draft only for what no review checks, since each drafting ticket's review already checked its Sections against the Outline.
// ../../promptText.ts's gapCheckPromptOf frames it with every other section the spec's tickets use; the record's schema is ../../recordSchema.ts's,
// and ../../reviewList.ts turns it into the last review-list comment; pieceWorkflow.ts supplies it, and ../../SpecRun/SpecEndRunner.ts launches it with no targets and posts that comment.

import type { GapCheckSection } from "../../Workflow.ts";

export function pieceGapCheckSectionOf(draftPath: string): GapCheckSection {
  return {
    workflow: "piece",
    place: "the Agent draft",
    checks: [
      `A piece ticket's work is the Agent draft every landed drafting ticket drafted, on master: \`${draftPath}\`.`,
      "Check only what no review checks: each drafting ticket's review already checked its Sections against the spec's Outline, Form and the writing rules, so never repeat it.",
      "Check each story against the Agent draft; a ticket closed as not planned drafted nothing.",
      "A Section that gives an ask in other words than the spec's is no gap.",
      "Never read or write the Deliverable's Doc.",
    ],
    followUp: "a drafting ticket",
    heldOpen: {
      name: "the Edit gate",
      description:
        "the developer's `ready-for-human` ticket to edit the Deliverable",
    },
  };
}
