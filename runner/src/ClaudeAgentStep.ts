import { spawn } from "node:child_process";
import {
  createWriteStream,
  openSync,
  readFileSync,
  type WriteStream,
} from "node:fs";
import { join } from "node:path";
import { createInterface } from "node:readline";

import type { AgentStep, Hang, StepRequest, StepResult } from "./AgentStep.ts";
import { StepStream } from "./StepStream.ts";
import { toolsOf } from "./targetTools.ts";

// The tier gate's runner-step mark and targets variable, named the same in .claude/hooks/lib/tiers/tiers.ts.
export const runnerStepMark = "BYRO_RUNNER_STEP";
export const stepTargetsVariable = "BYRO_STEP_TARGETS";
// Every hook command in .claude/settings.json runs its file from here, falling back to $CLAUDE_PROJECT_DIR.
const gateRootVariable = "BYRO_GATE_ROOT";

// One `mcpServers` entry, as Claude Code's config files hold it.
export type McpServerConfig = Record<string, unknown>;

export interface ClaudeAgentStepOptions {
  cswapPath?: string;
  gworkspaceServer?: McpServerConfig;
  permissionHook?: HookEntry;
}

// Runs `claude -p` under `cswap run <account> --`, which hands everything after `--` to claude as that account.
export class ClaudeAgentStep implements AgentStep {
  private readonly cswapPath: string;
  // The gworkspace MCP server's config, passed only to a step whose ticket names a target.
  private readonly gworkspaceServer: McpServerConfig | undefined;
  // Answers the permission prompts nobody is there to answer, added to each step's PermissionRequest hooks.
  private readonly permissionHook: HookEntry | undefined;

  constructor({
    cswapPath = "cswap",
    gworkspaceServer,
    permissionHook,
  }: ClaudeAgentStepOptions) {
    this.cswapPath = cswapPath;
    this.gworkspaceServer = gworkspaceServer;
    this.permissionHook = permissionHook;
  }

  static init(options: ClaudeAgentStepOptions = {}): ClaudeAgentStep {
    return new ClaudeAgentStep(options);
  }

  async run(request: StepRequest): Promise<StepResult> {
    const args = [
      ...commandArgs(request, this.permissionHook),
      ...mcpConfigArgsOf(request, this.gworkspaceServer),
    ];
    const log = openLog(request.logPath);
    const child = spawn(this.cswapPath, args, {
      cwd: request.cwd,
      env: stepEnvOf(request),
      stdio: ["ignore", "pipe", "inherit"],
    });
    // Resolved, not rejected, so a spawn error waits for the read loop instead of going unhandled.
    const exited = new Promise<Error | undefined>((resolve) => {
      child.on("error", resolve);
      child.on("close", () => resolve(undefined));
    });
    const stream = StepStream.init(request.liveCeiling);
    const lines = createInterface({ input: child.stdout });
    let hang: Hang | undefined;
    // Stdout is dropped too, so a tool's child still holding it can't keep the read loop open.
    function killOnHang(reason: Hang): void {
      hang = reason;
      child.kill();
      lines.close();
      child.stdout.destroy();
    }
    const wallClock = timerOf(request.wallClockMs, () =>
      killOnHang("wall-clock"),
    );
    const silence = timerOf(request.silenceTimeoutMs, () =>
      killOnHang("silence"),
    );
    try {
      for await (const line of lines) {
        silence?.refresh();
        if (log) log.write(`${line}\n`);
        stream.observeLine(line);
        // cswap execs claude, so the signal reaches the session itself.
        if (stream.hasCrossedCeiling && !child.killed) child.kill();
      }
    } finally {
      clearTimeout(wallClock);
      clearTimeout(silence);
    }
    if (log) await new Promise((resolve) => log.end(resolve));
    const spawnError = await exited;
    if (spawnError) throw spawnError;
    return { ...stream.toResult(request), hang };
  }
}

function timerOf(
  ms: number | undefined,
  onTimeout: () => void,
): NodeJS.Timeout | undefined {
  if (ms === undefined) return undefined;
  return setTimeout(onTimeout, ms);
}

// Opened before the spawn, so a bad path throws here instead of as an unhandled stream error.
function openLog(logPath: string | undefined): WriteStream | undefined {
  if (logPath === undefined) return undefined;
  return createWriteStream(logPath, { fd: openSync(logPath, "w") });
}

// Never bypassPermissions, and never `cswap switch`: the developer's active account stays theirs.
// Shared history lets a session resume on whichever account is active, rather than relying on cswap's global run.shareHistory setting.
function commandArgs(
  request: StepRequest,
  permissionHook: HookEntry | undefined,
): string[] {
  const args = [
    "run",
    String(request.account),
    "--share-history",
    "--",
    "-p",
    request.prompt,
    "--output-format",
    "stream-json",
    "--verbose",
    "--model",
    request.pair.model,
    "--effort",
    request.pair.effort,
    "--permission-mode",
    "acceptEdits",
    "--max-turns",
    String(request.maxTurns),
    "--json-schema",
    JSON.stringify(request.sessionSchema ?? request.jsonSchema),
    "--settings",
    JSON.stringify(settingsOf(request, permissionHook)),
  ];
  if (request.resumeSessionId) args.push("--resume", request.resumeSessionId);
  const targetTools = toolsOf(request.targets);
  if (targetTools.length > 0) args.push("--allowedTools", ...targetTools);
  const withheld = withheldGworkspaceToolsOf(request, targetTools);
  if (withheld.length > 0) args.push("--disallowedTools", ...withheld);
  return args;
}

// The primary allows gworkspace reads of any file, so a step with a server gets only those its targets give: a source, its two Drive reads.
function withheldGworkspaceToolsOf(
  { gateRoot, targets }: StepRequest,
  targetTools: string[],
): string[] {
  if (targets.length === 0) return [];
  const allowed = primarySettingsOf(gateRoot).permissions?.allow ?? [];
  return allowed.filter(
    (tool) =>
      tool.startsWith("mcp__gworkspace__") && !targetTools.includes(tool),
  );
}

export interface HookEntry {
  matcher?: string;
  hooks: { type: string; command: string }[];
}

export interface ProjectSettings {
  permissions?: { allow?: string[] };
  hooks?: Record<string, HookEntry[]>;
  sandbox?: { filesystem?: { allowRead?: string[] } };
}

// The primary's project settings, layered on the workspace's own: identical hook commands dedupe, so a workspace edit can't drop a primary gate.
function settingsOf(
  { gateRoot, cwd }: StepRequest,
  permissionHook: HookEntry | undefined,
): ProjectSettings {
  const primary = withAbsoluteAllowRead(primarySettingsOf(gateRoot), cwd);
  if (permissionHook === undefined) return primary;
  return {
    ...primary,
    hooks: {
      ...primary.hooks,
      PermissionRequest: [
        ...(primary.hooks?.PermissionRequest ?? []),
        permissionHook,
      ],
    },
  };
}

function primarySettingsOf(gateRoot: string): ProjectSettings {
  return JSON.parse(
    readFileSync(join(gateRoot, ".claude", "settings.json"), "utf8"),
  ) as ProjectSettings;
}

// A step's sandbox listed a `./` allowRead from `--settings` under /tmp/claude-501, not its workspace (H1 on #611), so tsc couldn't read the paths it re-opens.
function withAbsoluteAllowRead(
  settings: ProjectSettings,
  cwd: string,
): ProjectSettings {
  const filesystem = settings.sandbox?.filesystem;
  if (filesystem?.allowRead === undefined) return settings;
  return {
    ...settings,
    sandbox: {
      ...settings.sandbox,
      filesystem: {
        ...filesystem,
        allowRead: filesystem.allowRead.map((path) =>
          path.startsWith("./") ? join(cwd, path) : path,
        ),
      },
    },
  };
}

// A ticket with no targets gets no Google access at all.
function mcpConfigArgsOf(
  { targets }: StepRequest,
  gworkspaceServer: McpServerConfig | undefined,
): string[] {
  if (targets.length === 0) return [];
  if (gworkspaceServer === undefined) {
    throw new Error(
      "The ticket names targets, but the runner has no gworkspace server config to pass the step.",
    );
  }
  return [
    "--mcp-config",
    JSON.stringify({ mcpServers: { gworkspace: gworkspaceServer } }),
  ];
}

function stepEnvOf({ targets, gateRoot }: StepRequest): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {
    ...process.env,
    [runnerStepMark]: "1",
    [gateRootVariable]: gateRoot,
  };
  if (targets.length > 0) env[stepTargetsVariable] = JSON.stringify(targets);
  return env;
}
