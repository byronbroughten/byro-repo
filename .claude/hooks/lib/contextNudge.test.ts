import { describe, expect, it } from "vitest";

import { contextNudgeContext, contextSize } from "./contextNudge.ts";

interface Usage {
  input_tokens?: number;
  cache_read_input_tokens?: number;
  cache_creation_input_tokens?: number;
}

function assistantLine(usage: Usage): string {
  return JSON.stringify({ type: "assistant", message: { role: "assistant", usage } });
}

function transcript(...lines: string[]): string {
  return `${lines.join("\n")}\n`;
}

describe("contextSize", () => {
  it("sums input, cache-read and cache-creation tokens", () => {
    const line = assistantLine({ input_tokens: 3, cache_read_input_tokens: 120_000, cache_creation_input_tokens: 2_500 });
    expect(contextSize(transcript(line))).toBe(122_503);
  });

  it("reads the last assistant message, not an earlier one", () => {
    const earlier = assistantLine({ input_tokens: 10, cache_read_input_tokens: 50_000 });
    const user = JSON.stringify({ type: "user", message: { role: "user", content: "next" } });
    const last = assistantLine({ input_tokens: 10, cache_read_input_tokens: 90_000 });
    expect(contextSize(transcript(earlier, user, last, user))).toBe(90_010);
  });

  it("skips unparseable lines and messages with no usage", () => {
    const sized = assistantLine({ input_tokens: 7, cache_creation_input_tokens: 40_000 });
    const noUsage = JSON.stringify({ type: "assistant", message: { role: "assistant", content: [] } });
    const summary = JSON.stringify({ type: "summary", summary: "Earlier work" });
    expect(contextSize(transcript(sized, noUsage, summary, '{"type":"assist'))).toBe(40_007);
  });

  it("reads usage only from assistant lines", () => {
    const assistant = assistantLine({ input_tokens: 4, cache_read_input_tokens: 60_000 });
    const other = JSON.stringify({ type: "progress", message: { usage: { input_tokens: 999_999 } } });
    expect(contextSize(transcript(assistant, other))).toBe(60_004);
  });

  it("counts only numeric token fields", () => {
    const line = JSON.stringify({ type: "assistant", message: { usage: { input_tokens: "900000", cache_read_input_tokens: 12 } } });
    expect(contextSize(transcript(line))).toBe(12);
  });

  it("returns undefined for a transcript with no usage at all", () => {
    expect(contextSize("")).toBeUndefined();
    expect(contextSize(transcript("not json", JSON.stringify({ type: "user" })))).toBeUndefined();
  });
});

describe("contextNudgeContext", () => {
  function sized(tokens: number): string {
    return transcript(assistantLine({ input_tokens: 1, cache_read_input_tokens: tokens - 1 }));
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
