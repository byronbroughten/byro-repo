import { describe, expect, it } from "vitest";

import { contextNudgeContext } from "./contextNudge.ts";

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
    expect(contextNudgeContext(sized(149_999))).toBeUndefined();
    expect(contextNudgeContext("")).toBeUndefined();
  });

  it("nudges at and above the ticket budget, naming the size", () => {
    expect(contextNudgeContext(sized(150_000))).toMatch(/150K/);
    expect(contextNudgeContext(sized(297_700))).toMatch(/298K/);
  });

  it("points to the handoff rule and asks for a fresh session", () => {
    const nudge = contextNudgeContext(sized(160_000));
    expect(nudge).toMatch(/docs\/agents\/planning\.md#handoffs/);
    expect(nudge).toMatch(/fresh session/);
    expect(nudge).toMatch(/uncommitted/);
  });
});
