import { describe, expect, it } from "vitest";

import { contextNudgeOf, type ContextNudgeOptions } from "./contextNudge.ts";

const options: ContextNudgeOptions = {
  sessionId: "abc-123",
  ticketBudget: 150_000,
  handoffDocPath: "docs/agents/planning.md#handoffs",
};

function sized(tokens: number): string {
  const line = JSON.stringify({
    type: "assistant",
    message: {
      role: "assistant",
      usage: { input_tokens: 1, cache_read_input_tokens: tokens - 1 },
    },
  });
  return `${line}\n`;
}

describe("contextNudgeOf", () => {
  it("stays quiet under the ticket budget", () => {
    expect(contextNudgeOf(sized(149_999), options)).toBeUndefined();
    expect(contextNudgeOf("", options)).toBeUndefined();
  });

  it("nudges at and over the ticket budget, naming the size", () => {
    expect(contextNudgeOf(sized(150_000), options)).toMatch(/150K/);
    expect(contextNudgeOf(sized(297_700), options)).toMatch(/298K/);
  });

  it("reads the budget from its options", () => {
    const budget = { ...options, ticketBudget: 100_000 };

    expect(contextNudgeOf(sized(99_999), budget)).toBeUndefined();
    expect(contextNudgeOf(sized(100_000), budget)).toMatch(/past the 100K/);
  });

  it("asks for a handoff with no link when no handoff doc is set", () => {
    const nudge = contextNudgeOf(sized(160_000), {
      sessionId: "abc-123",
      ticketBudget: 150_000,
    });

    expect(nudge).toMatch(/your next and last step: an issue comment/);
    expect(nudge).not.toMatch(/, per /);
  });

  it("points to a set handoff doc and asks for a fresh session", () => {
    const nudge = contextNudgeOf(sized(160_000), options);

    expect(nudge).toMatch(/per docs\/agents\/planning\.md#handoffs/);
    expect(nudge).toMatch(/fresh session/);
    expect(nudge).toMatch(/uncommitted/);
  });

  it("asks the handoff comment to end with the session's id", () => {
    expect(contextNudgeOf(sized(160_000), options)).toMatch(
      /End the handoff comment with `session: abc-123`/,
    );
  });
});
