import { describe, expect, it } from "vitest";

import type { StepRequest } from "./AgentStep.ts";
import { StepStream } from "./StepStream.ts";

const request: StepRequest = {
  prompt: "Review it.",
  pair: { model: "sonnet", effort: "medium" },
  account: 1,
  cwd: "/workspace",
  gateRoot: "/primary",
  maxTurns: 10,
  targets: [],
  jsonSchema: {},
};

// An assistant event calling `name`, from the main loop or, with a parent, a subagent's own loop.
function toolCallOf(name: string, parent: string | null = null): string {
  return JSON.stringify({
    type: "assistant",
    parent_tool_use_id: parent,
    message: {
      id: `message-${name}`,
      content: [
        { type: "text", text: "Spawning." },
        { type: "tool_use", id: `tool-${name}`, name, input: {} },
      ],
    },
  });
}

describe("StepStream's subagent count", () => {
  it("counts each Agent call the main loop made, an older Task call included", () => {
    const result = StepStream.init()
      .observeLine(toolCallOf("Agent"))
      .observeLine(toolCallOf("Task"))
      .toResult(request);

    expect(result.spawnedSubagentCount).toBe(2);
  });

  it("leaves out other tools and the calls a subagent's own loop made", () => {
    const result = StepStream.init()
      .observeLine(toolCallOf("Read"))
      .observeLine(toolCallOf("Agent", "tool-parent"))
      .toResult(request);

    expect(result.spawnedSubagentCount).toBe(0);
  });
});
