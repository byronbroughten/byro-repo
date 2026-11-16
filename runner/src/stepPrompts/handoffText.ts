// The handoff wording every Workflow's implementer shares: the prompt's nudge section, a fresh step's section, the
// comment the runner posts, where in the steps it was handed off and a proposed split's text. Each step's own prompt
// stays in its file.

import { bulletsOf } from "../promptText.ts";
import type { Handoff, ProposedSlice } from "../stepRecords.ts";
import type { HandoffComment, HandoffPoint } from "../Workflow.ts";

export interface HandoffNudge {
  inHand: string;
  filesToOpen: string;
  stillFailing: string;
  // After "When less than half".
  splitWhen: string;
  slices: string;
}

export const handoffText = {
  nudgeSectionOf({
    inHand,
    filesToOpen,
    stillFailing,
    splitWhen,
    slices,
  }: HandoffNudge): string {
    return `## If a context nudge fires

The nudge's own handoff steps are for an interactive session; follow these instead. Finish the ${inHand} in hand, then stop: commit nothing, post nothing, and return status \`handoff\` with no branches and every \`handoff\` field: \`conclusion\`, \`filesToOpen\` (${filesToOpen}), \`ruledOut\`, \`filesChanged\`, and \`stillFailing\` (${stillFailing}). A handoff is cumulative: carry over whatever still matters from any handoff you started from. When less than half ${splitWhen} and the ticket split test (\`docs/agents/tickets.md#the-ticket-split-test\`) says the rest is more than one ticket, also fill \`proposedSplit\` with ${slices}, so the developer can split the ticket before a fresh step goes on.`;
  },

  previousSectionOf(handoff: Handoff): string {
    return `## Handoff from the previous step

The tree holds uncommitted work from the previous step. Don't reset, stash, check out or clean it; build on it.

${factsOf(handoff)}`;
  },

  // The runner posts it on the ticket; the `session:` line ties it to the step's transcript.
  commentOf({ handoff, sessionId, point }: HandoffComment): string {
    const { proposedSplit } = handoff;
    return [
      "## Handoff",
      `The implementer handed this ticket to a fresh session ${handoffText.pointOf(point)}.`,
      factsOf(handoff),
      ...(proposedSplit === undefined
        ? []
        : [`Proposed split:\n${handoffText.proposedSplitOf(proposedSplit)}`]),
      `session: ${sessionId}`,
    ].join("\n\n");
  },

  // As "in the implement step" or "before the review step", for the posted comment and the runner's own lines.
  pointOf({ relation, step }: HandoffPoint): string {
    return `${relation} the ${step} step`;
  },

  proposedSplitOf(slices: ProposedSlice[]): string {
    return slices
      .map(
        ({ delivers, files }, index) =>
          `${index + 1}. ${delivers} (${files.join(", ")})`,
      )
      .join("\n");
  },
};

function factsOf(handoff: Handoff): string {
  const filesToOpen = handoff.filesToOpen.map(
    ({ path, lines }) => `${path}:${lines}`,
  );
  return [
    `Conclusion: ${handoff.conclusion}`,
    `Files to open:${bulletsOf(filesToOpen)}`,
    `Ruled out:${bulletsOf(handoff.ruledOut)}`,
    `Files changed:${bulletsOf(handoff.filesChanged)}`,
    `Still failing:${bulletsOf(handoff.stillFailing)}`,
  ].join("\n");
}
