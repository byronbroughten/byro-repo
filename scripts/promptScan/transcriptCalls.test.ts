import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { type RecordedCall, recordedCallsOf } from "./transcriptCalls.ts";

function toolUseLine(id: string, name: string, input: object): string {
  return JSON.stringify({
    type: "assistant",
    message: { content: [{ type: "tool_use", id, name, input }] },
  });
}

function resultLine(id: string, permissionDecision?: object): string {
  return JSON.stringify({
    type: "user",
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

// Each fixture is a real transcript's entries, trimmed to the fields the scan reads.
function fixtureCallsOf(name: string): RecordedCall[] {
  const path = join(import.meta.dirname, "fixtures", `${name}.jsonl`);
  return recordedCallsOf(readFileSync(path, "utf8"));
}

describe("recordedCallsOf, on the stops no one answered", () => {
  it("reads a tier-gate refusal with the gate's reason: a wrap-up note holding an escaped `\\$(`", () => {
    const [call] = fixtureCallsOf("refusalOfAnEscapedSubstitution");
    expect(call?.command).toMatch(
      /^npm run wrap-up -- byro-repo 554 --closing/,
    );
    expect(call?.stop).toEqual({
      kind: "refusal",
      why: expect.stringMatching(
        /^Tier gate: `npm run wrap-up .* in the sandbox, where it fails without naming the box/,
      ),
    });
  });

  it("reads Claude Code's removal check", () => {
    const [call] = fixtureCallsOf("removalCheck");
    expect(call?.stop).toEqual({ kind: "removalCheck" });
  });

  it("reads a sandbox denial of a host from its `<sandbox_violations>` block", () => {
    const [call] = fixtureCallsOf("sandboxDeniedHost");
    expect(call?.stop).toEqual({
      kind: "sandboxDenial",
      denied: "cafe.github.com",
    });
  });

  it("reads a sandbox denial of a path from an `Operation not permitted` result", () => {
    const [call] = fixtureCallsOf("sandboxDeniedPath");
    expect(call?.stop).toEqual({
      kind: "sandboxDenial",
      denied: ".claude/hooks/.probe-r538",
    });
  });

  it("reads a Hand-back from a `! ` line in an assistant message", () => {
    expect(fixtureCallsOf("handBack")).toEqual([
      {
        tool: "Bash",
        command: expect.stringMatching(
          /^rm ~\/\.workspace-mcp\/attachments\/\*_4423b872/,
        ),
        stop: { kind: "handBack" },
      },
    ]);
  });

  it('leaves a developer\'s ask unstopped: a `gh issue create` loop after `cd "$TMPDIR/…"`', () => {
    const [call] = fixtureCallsOf("askOfAGhLoopAfterTmpdirCd");
    expect(call?.command).toMatch(/^cd "\$TMPDIR\/ct529" && for i in/);
    expect(call?.permission?.source).toBe("user_temporary");
    expect(call?.stop).toBeUndefined();
  });

  it("names only the path in an error that words its failure before the path", () => {
    const jsonl = [
      toolUseLine("c", "Bash", { command: "git checkout master" }),
      JSON.stringify({
        type: "user",
        message: { content: [{ type: "tool_result", tool_use_id: "c" }] },
        toolUseResult:
          "Error: Exit code 1\nerror: unable to create file .claude/agents/x.md: Operation not permitted",
        permissionDecision: developerYes,
      }),
    ].join("\n");
    expect(recordedCallsOf(jsonl)[0]?.stop).toEqual({
      kind: "sandboxDenial",
      denied: ".claude/agents/x.md",
    });
  });

  it("reads `Operation not permitted` only from what a Bash call wrote to stderr or failed with", () => {
    const jsonl = [
      toolUseLine("g", "Bash", { command: "grep -r denied ~/.claude" }),
      JSON.stringify({
        type: "user",
        message: { content: [{ type: "tool_result", tool_use_id: "g" }] },
        toolUseResult: {
          stdout: "touch: /a: Operation not permitted\n<sandbox_violations>",
          stderr: "",
        },
        permissionDecision: developerYes,
      }),
    ].join("\n");
    expect(recordedCallsOf(jsonl)[0]?.stop).toBeUndefined();
  });
});
