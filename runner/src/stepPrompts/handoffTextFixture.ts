import { expect } from "vitest";

// Checks an implement prompt's nudge section states the skip rule, in its Workflow's form, and the split rule.
export function expectNudgeRules(
  prompt: string | undefined,
  noJudgementLeft: string,
): void {
  expect(prompt).toContain(
    `Hand off only when work left needs judgement. When ${noJudgementLeft}, finish the rest`,
  );
  expect(prompt).toContain(
    "When the ticket split test (`docs/agents/tickets.md#the-ticket-split-test`) says the remaining work is more than one ticket, also fill `proposedSplit`",
  );
  expect(prompt).not.toContain("less than half");
}
