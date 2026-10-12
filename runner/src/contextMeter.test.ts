import { describe, expect, it } from "vitest";

import { ContextMeter } from "./contextMeter.ts";

interface Usage {
  input_tokens?: number;
  cache_read_input_tokens?: number;
  cache_creation_input_tokens?: number;
}

// The shape of a `claude -p --output-format stream-json --verbose` assistant event.
function streamEvent(
  id: string,
  usage: Usage,
  parentToolUseId: string | null = null,
): object {
  return {
    type: "assistant",
    message: { id, role: "assistant", usage },
    parent_tool_use_id: parentToolUseId,
  };
}

function peakOfStream(...events: object[]): number | undefined {
  const meter = ContextMeter.init();
  events.forEach((event) => meter.observe(event));
  return meter.peak;
}

describe("ContextMeter on a stream", () => {
  it("sums input, cache-read and cache-creation tokens", () => {
    const event = streamEvent("msg_1", {
      input_tokens: 3,
      cache_read_input_tokens: 120_000,
      cache_creation_input_tokens: 2_500,
    });
    expect(peakOfStream(event)).toBe(122_503);
  });

  it("takes the largest message, not the last one", () => {
    const peak = streamEvent("msg_1", {
      input_tokens: 10,
      cache_read_input_tokens: 90_000,
    });
    const later = streamEvent("msg_2", {
      input_tokens: 10,
      cache_read_input_tokens: 30_000,
    });
    expect(peakOfStream(peak, later)).toBe(90_010);
  });

  it("skips a subagent's messages", () => {
    const main = streamEvent("msg_1", {
      input_tokens: 5,
      cache_read_input_tokens: 40_000,
    });
    const subagent = streamEvent(
      "msg_2",
      { input_tokens: 5, cache_read_input_tokens: 170_000 },
      "toolu_1",
    );
    expect(peakOfStream(main, subagent)).toBe(40_005);
  });

  it("reads usage only from assistant events", () => {
    const main = streamEvent("msg_1", {
      input_tokens: 4,
      cache_read_input_tokens: 60_000,
    });
    const result = {
      type: "result",
      subtype: "success",
      usage: { input_tokens: 999_999 },
      message: { usage: { input_tokens: 999_999 } },
    };
    expect(peakOfStream(main, result)).toBe(60_004);
  });

  it("counts a message split across events once, by its latest reading", () => {
    const firstBlock = streamEvent("msg_1", {
      input_tokens: 2,
      cache_read_input_tokens: 100_000,
    });
    const secondBlock = streamEvent("msg_1", {
      input_tokens: 2,
      cache_read_input_tokens: 80_000,
    });
    const next = streamEvent("msg_2", {
      input_tokens: 2,
      cache_read_input_tokens: 50_000,
    });
    expect(peakOfStream(firstBlock, secondBlock, next)).toBe(80_002);
  });

  it("has no peak before any main-loop message", () => {
    expect(peakOfStream()).toBeUndefined();
    expect(peakOfStream({ type: "system", subtype: "init" })).toBeUndefined();
  });
});

function transcriptLine(usage: Usage, fields: object = {}): string {
  return JSON.stringify({
    type: "assistant",
    ...fields,
    message: { role: "assistant", usage },
  });
}

function transcript(...lines: string[]): string {
  return `${lines.join("\n")}\n`;
}

describe("ContextMeter.ofTranscript", () => {
  it("sums input, cache-read and cache-creation tokens", () => {
    const line = transcriptLine({
      input_tokens: 3,
      cache_read_input_tokens: 120_000,
      cache_creation_input_tokens: 2_500,
    });
    expect(ContextMeter.ofTranscript(transcript(line))).toBe(122_503);
  });

  it("reaches the last assistant message past user lines", () => {
    const earlier = transcriptLine({
      input_tokens: 10,
      cache_read_input_tokens: 50_000,
    });
    const user = JSON.stringify({
      type: "user",
      message: { role: "user", content: "next" },
    });
    const last = transcriptLine({
      input_tokens: 10,
      cache_read_input_tokens: 90_000,
    });
    expect(
      ContextMeter.ofTranscript(transcript(earlier, user, last, user)),
    ).toBe(90_010);
  });

  it("keeps the peak after context shrinks", () => {
    const peak = transcriptLine({
      input_tokens: 10,
      cache_read_input_tokens: 160_000,
    });
    const afterCompact = transcriptLine({
      input_tokens: 10,
      cache_read_input_tokens: 20_000,
    });
    expect(ContextMeter.ofTranscript(transcript(peak, afterCompact))).toBe(
      160_010,
    );
  });

  it("skips unparseable lines and messages with no usage", () => {
    const sized = transcriptLine({
      input_tokens: 7,
      cache_creation_input_tokens: 40_000,
    });
    const noUsage = JSON.stringify({
      type: "assistant",
      message: { role: "assistant", content: [] },
    });
    const summary = JSON.stringify({
      type: "summary",
      summary: "Earlier work",
    });
    expect(
      ContextMeter.ofTranscript(
        transcript(sized, noUsage, summary, '{"type":"assist'),
      ),
    ).toBe(40_007);
  });

  it("reads usage only from assistant lines", () => {
    const assistant = transcriptLine({
      input_tokens: 4,
      cache_read_input_tokens: 60_000,
    });
    const other = JSON.stringify({
      type: "progress",
      message: { usage: { input_tokens: 999_999 } },
    });
    expect(ContextMeter.ofTranscript(transcript(assistant, other))).toBe(
      60_004,
    );
  });

  it("skips sidechain lines", () => {
    const main = transcriptLine(
      { input_tokens: 4, cache_read_input_tokens: 30_000 },
      { isSidechain: false },
    );
    const sidechain = transcriptLine(
      { input_tokens: 4, cache_read_input_tokens: 190_000 },
      { isSidechain: true },
    );
    expect(ContextMeter.ofTranscript(transcript(main, sidechain))).toBe(30_004);
  });

  it("counts lines sharing a message id once, by the latest", () => {
    const text = JSON.stringify({
      type: "assistant",
      message: {
        id: "msg_1",
        usage: { input_tokens: 1, cache_read_input_tokens: 70_000 },
      },
    });
    const toolUse = JSON.stringify({
      type: "assistant",
      message: {
        id: "msg_1",
        usage: { input_tokens: 1, cache_read_input_tokens: 65_000 },
      },
    });
    expect(ContextMeter.ofTranscript(transcript(text, toolUse))).toBe(65_001);
  });

  it("counts only numeric token fields", () => {
    const line = JSON.stringify({
      type: "assistant",
      message: {
        usage: { input_tokens: "900000", cache_read_input_tokens: 12 },
      },
    });
    expect(ContextMeter.ofTranscript(transcript(line))).toBe(12);
  });

  it("returns undefined for a transcript with no usage at all", () => {
    expect(ContextMeter.ofTranscript("")).toBeUndefined();
    expect(
      ContextMeter.ofTranscript(
        transcript("not json", JSON.stringify({ type: "user" })),
      ),
    ).toBeUndefined();
  });
});
