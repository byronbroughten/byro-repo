import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import type { StepRequest, StepResult } from "./AgentStep.ts";
import { ClaudeAgentStep, type ProjectSettings } from "./ClaudeAgentStep.ts";

const fixturesFolder = fileURLToPath(
  new URL("../fixtures/stream/", import.meta.url),
);

// The schema the recorded streams ran with.
const answerSchema = {
  type: "object",
  properties: { answer: { type: "string" } },
  required: ["answer"],
};

// A stand-in primary's settings: one gate on PreToolUse and a PermissionRequest hook of its own.
const gateHook = {
  type: "command",
  command: `node "\${BYRO_GATE_ROOT:-$CLAUDE_PROJECT_DIR}/.claude/hooks/tierGate.ts"`,
};
const primaryPermissionHook = {
  type: "command",
  command: `node "\${BYRO_GATE_ROOT:-$CLAUDE_PROJECT_DIR}/.claude/hooks/ask.ts"`,
};
const primarySettings = {
  permissions: { deny: ["Edit(**/.env*)"] },
  hooks: {
    PreToolUse: [{ matcher: "Bash", hooks: [gateHook] }],
    PermissionRequest: [{ matcher: "Bash", hooks: [primaryPermissionHook] }],
  },
};
const primaryRoot = mkdtempSync(join(tmpdir(), "agent-step-primary-"));
mkdirSync(join(primaryRoot, ".claude"));
writeFileSync(
  join(primaryRoot, ".claude", "settings.json"),
  JSON.stringify(primarySettings),
);

function request(overrides: Partial<StepRequest> = {}): StepRequest {
  return {
    prompt: "/implement byro-repo #216",
    pair: { model: "opus", effort: "medium" },
    account: 2,
    cwd: "/Users/dev/byro-repo/.claude/worktrees/byro-repo-issue-216",
    gateRoot: primaryRoot,
    maxTurns: 40,
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

type PassedSettings = ProjectSettings & { permissions?: unknown };

function passedSettingsOf(argv: string[]): PassedSettings {
  return JSON.parse(
    argv[argv.indexOf("--settings") + 1] ?? "",
  ) as PassedSettings;
}

// The step's own permission hook, which the repo's config injects.
const permissionHook = {
  matcher: "Edit|Write|Bash|Read",
  hooks: [{ type: "command", command: "node stepPermission.ts" }],
};

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
    `#!/bin/sh\nprintf '%s\\n' "$@" > '${argvPath}'\nprintf '%s' "$BYRO_RUNNER_STEP" > '${join(dir, "mark")}'\nprintf '%s' "$BYRO_STEP_TARGETS" > '${join(dir, "targets")}'\nprintf '%s' "$BYRO_GATE_ROOT" > '${join(dir, "gateRoot")}'\ncat '${join(fixturesFolder, fixture)}'\n`,
    { mode: 0o755 },
  );
  const result = await ClaudeAgentStep.init({
    cswapPath,
    gworkspaceServer,
    permissionHook,
  }).run(request({ cwd: dir, ...overrides }));
  const argv = readFileSync(argvPath, "utf8").split("\n").slice(0, -1);
  return { result, argv, cwd: dir };
}

describe("ClaudeAgentStep on a recorded success", () => {
  it("returns the validated record and its session", async () => {
    const { result } = await replay("success.ndjson");
    expect(result).toEqual({
      output: { status: "valid", record: { answer: "ok" } },
      sessionId: "0e3dc8b3-fd87-4381-b3dc-8c36c1e03e1b",
      account: 2,
      peakContext: 20_221,
      hasCrossedCeiling: false,
      hang: undefined,
      exitSubtype: "success",
      errorText: undefined,
      hasNoConversation: false,
      usage: {
        fiveHour: { utilization: 0.01, resetsAt: new Date(1791781200_000) },
        sevenDay: { utilization: 0.5, resetsAt: new Date(1791903600_000) },
      },
      limitHit: undefined,
      deniedTools: [],
    });
  });

  // Derived from the success recording with two entries in its result's permission_denials.
  it("returns the name of each tool its result records as denied", async () => {
    const { result } = await replay("permissionDenials.ndjson");
    expect(result.deniedTools).toEqual([
      "Bash",
      "mcp__gworkspace__modify_sheet_values",
    ]);
  });
});

describe("ClaudeAgentStep's command", () => {
  it("runs claude as the account with shared history, in acceptEdits with the pair, cap and schema", async () => {
    const { argv } = await replay("success.ndjson");
    expect(argv).toEqual([
      "run",
      "2",
      "--share-history",
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
    ]);
  });

  it("runs the step under the primary's gate, with project settings still loaded", async () => {
    const { argv, cwd } = await replay("success.ndjson");
    expect(readFileSync(join(cwd, "gateRoot"), "utf8")).toBe(primaryRoot);
    expect(argv).not.toContain("--setting-sources");
    const settings = passedSettingsOf(argv);
    expect(settings.permissions).toEqual(primarySettings.permissions);
    expect(settings.hooks?.PreToolUse).toEqual(
      primarySettings.hooks.PreToolUse,
    );
    expect(settings.hooks?.PermissionRequest).toEqual([
      { matcher: "Bash", hooks: [primaryPermissionHook] },
      permissionHook,
    ]);
  });

  it("launches the step with the runner-step mark in its environment", async () => {
    const { cwd } = await replay("success.ndjson");
    expect(readFileSync(join(cwd, "mark"), "utf8")).toBe("1");
  });

  it("resumes the given session with shared history", async () => {
    const { argv } = await replay("success.ndjson", {
      resumeSessionId: "0e3dc8b3-fd87-4381-b3dc-8c36c1e03e1b",
    });
    expect(argv.slice(0, 4)).toEqual(["run", "2", "--share-history", "--"]);
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
      targets: [{ kind: "doc", id: "doc1" }],
    });
    const tools = argv.slice(argv.indexOf("--allowedTools") + 1);
    expect(tools).toContain("mcp__gworkspace__modify_doc_text");
    expect(tools).not.toContain("mcp__gworkspace__modify_sheet_values");
    expect(tools.some((tool) => tool.startsWith("Bash("))).toBe(false);
    expect(argv).toContain("--mcp-config");
  });

  it("passes no gworkspace server, no targets and no --allowedTools when the ticket names none", async () => {
    const { argv, cwd } = await replay("success.ndjson");
    expect(argv).not.toContain("--mcp-config");
    expect(argv).not.toContain("--allowedTools");
    expect(readFileSync(join(cwd, "targets"), "utf8")).toBe("");
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
    expect(result.hasNoConversation).toBe(false);
  });

  // Recorded from a resolve resume whose transcript was gone.
  it("says a resume found no conversation for its session", async () => {
    const { result } = await replay("noConversation.ndjson");
    expect(result.hasNoConversation).toBe(true);
    expect(result.exitSubtype).toBe("error_during_execution");
    expect(result.output).toEqual({ status: "none" });
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

describe("ClaudeAgentStep's live ceiling", () => {
  // A stand-in claude that reports one main-loop reply's context, then runs on until killed.
  async function runPast(peak: number): Promise<StepResult> {
    const liveCeiling = 180_000;
    const dir = mkdtempSync(join(tmpdir(), "agent-step-ceiling-"));
    const reply = JSON.stringify({
      type: "assistant",
      message: { id: "m1", usage: { input_tokens: peak } },
    });
    const cswapPath = join(dir, "cswap");
    writeFileSync(
      cswapPath,
      `#!/bin/sh\nprintf '%s\\n' '${reply}'\nexec sleep ${peak > liveCeiling ? 30 : 0}\n`,
      { mode: 0o755 },
    );
    return ClaudeAgentStep.init({ cswapPath }).run(
      request({ cwd: dir, liveCeiling }),
    );
  }

  it("kills a session whose context crosses the ceiling and says so", async () => {
    const result = await runPast(181_000);
    expect(result.hasCrossedCeiling).toBe(true);
    expect(result.peakContext).toBe(181_000);
    expect(result.output).toEqual({ status: "none" });
  });

  it("lets a session at the ceiling run to its end", async () => {
    const result = await runPast(180_000);
    expect(result.hasCrossedCeiling).toBe(false);
  });
});

describe("ClaudeAgentStep's hang limits", () => {
  const line = `printf '%s\\n' '{"type":"system"}'`;

  // A stand-in claude that runs the script as its body; exec'd sleeps leave nothing behind once killed.
  async function runStandIn(
    script: string,
    overrides: Partial<StepRequest>,
  ): Promise<StepResult> {
    const dir = mkdtempSync(join(tmpdir(), "agent-step-hang-"));
    const cswapPath = join(dir, "cswap");
    writeFileSync(cswapPath, `#!/bin/sh\n${script}\n`, { mode: 0o755 });
    return ClaudeAgentStep.init({ cswapPath }).run(
      request({ cwd: dir, ...overrides }),
    );
  }

  it("kills a session whose stream goes silent past the silence timeout and says so", async () => {
    const result = await runStandIn(`${line}; exec sleep 30`, {
      silenceTimeoutMs: 200,
    });
    expect(result.hang).toBe("silence");
    expect(result.exitSubtype).toBeUndefined();
  });

  it("kills a session still talking past its wall clock and says so", async () => {
    const result = await runStandIn(
      `while true; do ${line}; sleep 0.05; done`,
      {
        silenceTimeoutMs: 5_000,
        wallClockMs: 300,
      },
    );
    expect(result.hang).toBe("wall-clock");
  });

  it("leaves a session that ends inside both limits unflagged", async () => {
    const { result } = await replay("success.ndjson", {
      silenceTimeoutMs: 5_000,
      wallClockMs: 5_000,
    });
    expect(result.hang).toBeUndefined();
  });
});
