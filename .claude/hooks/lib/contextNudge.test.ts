import { describe, expect, it } from "vitest";

import { contextNudgeContext, type ContextNudgeKnobs } from "./contextNudge.ts";

const knobs: ContextNudgeKnobs = {
  ticketBudget: 150_000,
  handoffDocPath: "docs/agents/planning.md#handoffs",
};

interface Usage {
  input_tokens?: number;
  cache_read_input_tokens?: number;
  cache_creation_input_tokens?: number;
}

function assistantLine(usage: Usage): string {
  return JSON.stringify({
    type: "assistant",
    message: { role: "assistant", usage },
  });
}

function transcript(...lines: string[]): string {
  return `${lines.join("\n")}\n`;
}

describe("contextNudgeContext", () => {
  function sized(tokens: number): string {
    return transcript(
      assistantLine({ input_tokens: 1, cache_read_input_tokens: tokens - 1 }),
    );
  }

  it("stays quiet below the ticket budget", () => {
    expect(contextNudgeContext(sized(149_999), knobs)).toBeUndefined();
    expect(contextNudgeContext("", knobs)).toBeUndefined();
  });

  it("nudges at and above the ticket budget, naming the size", () => {
    expect(contextNudgeContext(sized(150_000), knobs)).toMatch(/150K/);
    expect(contextNudgeContext(sized(297_700), knobs)).toMatch(/298K/);
  });

  it("reads the budget from its knobs", () => {
    const budget = { ...knobs, ticketBudget: 100_000 };

    expect(contextNudgeContext(sized(99_999), budget)).toBeUndefined();
    expect(contextNudgeContext(sized(100_000), budget)).toMatch(
      /past the 100K/,
    );
  });

  it("asks for a handoff with no link when no handoff doc is set", () => {
    const nudge = contextNudgeContext(sized(160_000), {
      ticketBudget: 150_000,
    });

    expect(nudge).toMatch(/your next and last step: an issue comment/);
  });

  it("points to the handoff rule and asks for a fresh session", () => {
    const nudge = contextNudgeContext(sized(160_000), knobs);
    expect(nudge).toMatch(/docs\/agents\/planning\.md#handoffs/);
    expect(nudge).toMatch(/fresh session/);
    expect(nudge).toMatch(/uncommitted/);
  });
});
