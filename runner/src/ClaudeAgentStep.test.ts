import { execSync } from "node:child_process";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import type { StepRequest, StepResult } from "./AgentStep.ts";
import { ClaudeAgentStep } from "./ClaudeAgentStep.ts";

const fixturesFolder = fileURLToPath(
  new URL("../fixtures/stream/", import.meta.url),
);

// The schema the recorded streams ran with.
const answerSchema = {
  type: "object",
  properties: { answer: { type: "string" } },
  required: ["answer"],
};

function request(overrides: Partial<StepRequest> = {}): StepRequest {
  return {
    prompt: "/implement byro-repo #216",
    pair: { model: "opus", effort: "medium" },
    account: 2,
    cwd: "/Users/dev/byro-repo",
    maxTurns: 40,
    allowedTools: ["Bash(npm run tsc)", "Bash(git commit *)"],
    allowedWriteGlobs: [".claude/skills/**"],
    targets: [],
    jsonSchema: answerSchema,
    ...overrides,
  };
}

const gworkspaceServer = {
  type: "stdio",
  command: "uvx",
  args: ["workspace-mcp==1.28.0", "--single-user"],
};

interface Replay {
  result: StepResult;
  argv: string[];
  cwd: string;
}

function permissionRequestCommandOf(argv: string[]): string {
  const settings = JSON.parse(argv[argv.indexOf("--settings") + 1] ?? "") as {
    hooks: { PermissionRequest: [{ hooks: [{ command: string }] }] };
  };
  return settings.hooks.PermissionRequest[0].hooks[0].command;
}

// Runs the real adapter against a stand-in cswap that records its argv and prints a recorded stream.
async function replay(
  fixture: string,
  overrides: Partial<StepRequest> = {},
): Promise<Replay> {
  const dir = mkdtempSync(join(tmpdir(), "agent-step-"));
  const argvPath = join(dir, "argv");
  const cswapPath = join(dir, "cswap");
  writeFileSync(
    cswapPath,
    `#!/bin/sh\nprintf '%s\\n' "$@" > '${argvPath}'\nprintf '%s' "$BYRO_RUNNER_STEP" > '${join(dir, "mark")}'\nprintf '%s' "$BYRO_STEP_TARGETS" > '${join(dir, "targets")}'\ncat '${join(fixturesFolder, fixture)}'\n`,
    { mode: 0o755 },
  );
  const result = await ClaudeAgentStep.init(cswapPath, gworkspaceServer).run(
    request({ cwd: dir, ...overrides }),
  );
  const argv = readFileSync(argvPath, "utf8").split("\n").slice(0, -1);
  return { result, argv, cwd: dir };
}

describe("ClaudeAgentStep on a recorded success", () => {
  it("returns the validated record and where the session lives", async () => {
    const { result } = await replay("success.ndjson");
    expect(result).toEqual({
      output: { status: "valid", record: { answer: "ok" } },
      sessionId: "0e3dc8b3-fd87-4381-b3dc-8c36c1e03e1b",
      account: 2,
      configFolder: "/Users/dev/.claude-swap-backup/sessions/2-dev_example.com",
      transcriptPath:
        "/Users/dev/.claude-swap-backup/sessions/2-dev_example.com/projects/-Users-dev-byro-repo/0e3dc8b3-fd87-4381-b3dc-8c36c1e03e1b.jsonl",
      peakContext: 20_221,
      exitSubtype: "success",
      errorText: undefined,
      usage: {
        fiveHour: { utilization: 0.01, resetsAt: new Date(1791781200_000) },
        sevenDay: { utilization: 0.5, resetsAt: new Date(1791903600_000) },
      },
      limitHit: undefined,
    });
  });
});

describe("ClaudeAgentStep's command", () => {
  it("runs claude as the account in acceptEdits with the pair, cap, schema and tools", async () => {
    const { argv } = await replay("success.ndjson");
    expect(argv).toEqual([
      "run",
      "2",
      "--",
      "-p",
      "/implement byro-repo #216",
      "--output-format",
      "stream-json",
      "--verbose",
      "--model",
      "opus",
      "--effort",
      "medium",
      "--permission-mode",
      "acceptEdits",
      "--max-turns",
      "40",
      "--json-schema",
      '{"type":"object","properties":{"answer":{"type":"string"}},"required":["answer"]}',
      "--settings",
      expect.any(String),
      "--allowedTools",
      "Bash(npm run tsc)",
      "Bash(git commit *)",
    ]);
  });

  it("registers a PermissionRequest hook that allows a skill write in the step's workspace", async () => {
    const { argv, cwd } = await replay("success.ndjson");
    const command = permissionRequestCommandOf(argv);
    const skillWrite = (path: string) =>
      execSync(command, {
        cwd,
        encoding: "utf8",
        input: JSON.stringify({
          hook_event_name: "PermissionRequest",
          tool_name: "Write",
          tool_input: { file_path: join(cwd, path), content: "# Skill\n" },
        }),
      });
    expect(JSON.parse(skillWrite(".claude/skills/tdd/SKILL.md"))).toEqual({
      hookSpecificOutput: {
        hookEventName: "PermissionRequest",
        decision: { behavior: "allow" },
      },
    });
    expect(skillWrite(".claude/agents/explorer.md")).toBe("");
  });

  it("launches the step with the runner-step mark in its environment", async () => {
    const { cwd } = await replay("success.ndjson");
    expect(readFileSync(join(cwd, "mark"), "utf8")).toBe("1");
  });

  it("resumes the given session", async () => {
    const { argv } = await replay("success.ndjson", {
      resumeSessionId: "0e3dc8b3-fd87-4381-b3dc-8c36c1e03e1b",
    });
    const flag = argv.indexOf("--resume");
    expect(argv[flag + 1]).toBe("0e3dc8b3-fd87-4381-b3dc-8c36c1e03e1b");
  });

  it("never bypasses permissions or switches the active account", async () => {
    const { argv } = await replay("success.ndjson");
    expect(argv).not.toContain("bypassPermissions");
    expect(argv).not.toContain("--dangerously-skip-permissions");
    expect(argv).not.toContain("switch");
  });

  it("adds a spreadsheet target's live aliases and the Sheets tools, with the gworkspace server and the targets in the environment", async () => {
    const { argv, cwd } = await replay("success.ndjson", {
      targets: [{ kind: "spreadsheet", name: "app" }],
    });
    const tools = argv.slice(argv.indexOf("--allowedTools") + 1);
    expect(tools.slice(0, 2)).toEqual([
      "Bash(npm run tsc)",
      "Bash(git commit *)",
    ]);
    expect(tools).toContain("Bash(npm run app:chore*)");
    expect(tools).toContain("mcp__gworkspace__modify_sheet_values");
    expect(tools).not.toContain("Bash(npm run dev:chore*)");
    expect(tools).not.toContain("mcp__gworkspace__modify_doc_text");
    expect(JSON.parse(argv[argv.indexOf("--mcp-config") + 1] ?? "")).toEqual({
      mcpServers: { gworkspace: gworkspaceServer },
    });
    expect(JSON.parse(readFileSync(join(cwd, "targets"), "utf8"))).toEqual([
      { kind: "spreadsheet", name: "app" },
    ]);
  });

  it("adds a Doc target's Docs tools and no live aliases", async () => {
    const { argv } = await replay("success.ndjson", {
      allowedTools: [],
      targets: [{ kind: "doc", id: "doc1" }],
    });
    const tools = argv.slice(argv.indexOf("--allowedTools") + 1);
    expect(tools).toContain("mcp__gworkspace__modify_doc_text");
    expect(tools).not.toContain("mcp__gworkspace__modify_sheet_values");
    expect(tools.some((tool) => tool.startsWith("Bash("))).toBe(false);
    expect(argv).toContain("--mcp-config");
  });

  it("passes no gworkspace server and no targets when the ticket names none", async () => {
    const { argv, cwd } = await replay("success.ndjson");
    expect(argv).not.toContain("--mcp-config");
    expect(readFileSync(join(cwd, "targets"), "utf8")).toBe("");
  });

  it("leaves out --allowedTools when the list is empty", async () => {
    const { argv } = await replay("success.ndjson", { allowedTools: [] });
    expect(argv).not.toContain("--allowedTools");
  });
});

describe("ClaudeAgentStep's schema failures", () => {
  it("counts a success with no structured output as a schema failure, keeping the raw output", async () => {
    const { result } = await replay("noStructuredOutput.ndjson");
    expect(result.exitSubtype).toBe("success");
    expect(result.output).toMatchObject({
      status: "schemaFailure",
      problems: ["no structured output"],
    });
    expect(result.output).toHaveProperty(
      "rawOutput",
      expect.stringContaining("I couldn't complete this."),
    );
  });

  it("counts structured output failing the schema as a schema failure", async () => {
    const countSchema = {
      type: "object",
      properties: { count: { type: "integer" } },
      required: ["count"],
    };
    const { result } = await replay("success.ndjson", {
      jsonSchema: countSchema,
    });
    expect(result.output).toEqual({
      status: "schemaFailure",
      rawOutput: '{"answer":"ok"}',
      problems: ["/ must have required property 'count'"],
    });
  });
});

describe("ClaudeAgentStep on failed runs", () => {
  it("returns the turn cap's subtype with no record", async () => {
    const { result } = await replay("maxTurns.ndjson");
    expect(result.exitSubtype).toBe("error_max_turns");
    expect(result.output).toEqual({ status: "none" });
    expect(result.limitHit).toBeUndefined();
  });

  // Derived from the turn-cap recording with its result's subtype changed.
  it("returns error_during_execution with no record", async () => {
    const { result } = await replay("errorDuringExecution.ndjson");
    expect(result.exitSubtype).toBe("error_during_execution");
    expect(result.output).toEqual({ status: "none" });
  });

  // Derived from the limit-error recording with a 400 result, as a refused tool schema gives.
  it("returns an API error's text with no record or limit hit", async () => {
    const { result } = await replay("apiError.ndjson");
    expect(result.exitSubtype).toBe("success");
    expect(result.errorText).toContain("API Error: 400");
    expect(result.output).toEqual({ status: "none" });
    expect(result.limitHit).toBeUndefined();
  });

  it("returns no error text on a run that wasn't an error", async () => {
    const { result } = await replay("maxTurns.ndjson");
    expect(result.errorText).toBeUndefined();
  });

  // Derived from the success recording: a rejected rate_limit_event and a 429 result.
  it("returns a limit hit with its window and reset time", async () => {
    const { result } = await replay("rateLimited.ndjson");
    expect(result.limitHit).toEqual({
      window: "five_hour",
      resetsAt: new Date(1791781200_000),
    });
    expect(result.usage?.fiveHour?.utilization).toBe(1);
    expect(result.output).toEqual({ status: "none" });
  });

  // Derived the same way, with the event still allowed: the 429 alone is the hit.
  it("returns a limit error result as a limit hit naming no window", async () => {
    const { result } = await replay("limitErrorResult.ndjson");
    expect(result.limitHit).toEqual({ window: undefined, resetsAt: undefined });
  });
});

describe("ClaudeAgentStep's log", () => {
  it("writes the raw stream to the given log file", async () => {
    const logPath = join(mkdtempSync(join(tmpdir(), "agent-step-log-")), "log");
    await replay("success.ndjson", { logPath });
    expect(readFileSync(logPath, "utf8")).toBe(
      readFileSync(join(fixturesFolder, "success.ndjson"), "utf8"),
    );
  });

  it("throws on a log path it can't open", async () => {
    const logPath = join(tmpdir(), "no-such-folder-agent-step", "log");
    await expect(replay("success.ndjson", { logPath })).rejects.toThrow(
      "ENOENT",
    );
  });
});
