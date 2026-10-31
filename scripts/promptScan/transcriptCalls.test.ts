import { describe, expect, it } from "vitest";

import { recordedCallsOf } from "./transcriptCalls.ts";

function toolUseLine(id: string, name: string, input: object): string {
  return JSON.stringify({
    type: "assistant",
    message: { content: [{ type: "tool_use", id, name, input }] },
  });
}

function resultLine(id: string, permissionDecision?: object): string {
  return JSON.stringify({
    type: "user",
    cwd: "/repo",
    message: { content: [{ type: "tool_result", tool_use_id: id }] },
    permissionDecision,
  });
}

const developerYes = {
  source: "user_temporary",
  decision: "accept",
  reasonCode: "hook:PreToolUse",
  grantScope: "once",
};

describe("recordedCallsOf", () => {
  it("joins each answered tool result to its call", () => {
    const jsonl = [
      toolUseLine("a", "Bash", { command: "gh issue view 3" }),
      resultLine("a", developerYes),
    ].join("\n");
    expect(recordedCallsOf(jsonl)).toEqual([
      {
        tool: "Bash",
        command: "gh issue view 3",
        target: undefined,
        cwd: "/repo",
        permission: {
          source: "user_temporary",
          decision: "accept",
          reasonType: undefined,
          reasonCode: "hook:PreToolUse",
        },
      },
    ]);
  });

  it("names what another tool acted on, and keeps its command out of the Bash field", () => {
    const jsonl = [
      toolUseLine("w", "Write", { file_path: "/tmp/a.md", content: "x" }),
      resultLine("w", {
        source: "config",
        decision: "accept",
        reasonType: "classifier",
      }),
      toolUseLine("m", "Monitor", { command: "npm run runner -- watch" }),
      resultLine("m", {
        source: "config",
        decision: "accept",
        reasonType: "classifier",
      }),
    ].join("\n");
    expect(
      recordedCallsOf(jsonl).map(({ tool, command, target }) => ({
        tool,
        command,
        target,
      })),
    ).toEqual([
      { tool: "Write", command: undefined, target: "/tmp/a.md" },
      {
        tool: "Monitor",
        command: undefined,
        target: "npm run runner -- watch",
      },
    ]);
  });

  it("skips a result with no permission answer, an unknown call and a line that isn't JSON", () => {
    const jsonl = [
      toolUseLine("a", "Read", { file_path: "/repo/a.ts" }),
      resultLine("a"),
      resultLine("missing", developerYes),
      "{not json",
      "",
    ].join("\n");
    expect(recordedCallsOf(jsonl)).toEqual([]);
  });
});
