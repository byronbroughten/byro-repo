import { spawn } from "node:child_process";
import { createWriteStream, openSync, type WriteStream } from "node:fs";
import { createInterface } from "node:readline";
import { fileURLToPath } from "node:url";

import type { AgentStep, StepRequest, StepResult } from "./AgentStep.ts";
import type { SkillWriteHookArgs } from "./skillWriteHook.ts";
import { StepStream } from "./StepStream.ts";

const skillWriteHookPath = fileURLToPath(
  new URL("./skillWriteHook.ts", import.meta.url),
);

// Runs `claude -p` under `cswap run <account> --`, which hands everything after `--` to claude as that account.
export class ClaudeAgentStep implements AgentStep {
  private readonly cswapPath: string;

  constructor(cswapPath: string) {
    this.cswapPath = cswapPath;
  }

  static init(cswapPath = "cswap"): ClaudeAgentStep {
    return new ClaudeAgentStep(cswapPath);
  }

  async run(request: StepRequest): Promise<StepResult> {
    const log = openLog(request.logPath);
    const child = spawn(this.cswapPath, commandArgs(request), {
      cwd: request.cwd,
      stdio: ["ignore", "pipe", "inherit"],
    });
    // Resolved, not rejected, so a spawn error waits for the read loop instead of going unhandled.
    const exited = new Promise<Error | undefined>((resolve) => {
      child.on("error", resolve);
      child.on("close", () => resolve(undefined));
    });
    const stream = StepStream.init();
    for await (const line of createInterface({ input: child.stdout })) {
      if (log) log.write(`${line}\n`);
      stream.observeLine(line);
    }
    if (log) await new Promise((resolve) => log.end(resolve));
    const spawnError = await exited;
    if (spawnError) throw spawnError;
    return stream.toResult(request);
  }
}

// Opened before the spawn, so a bad path throws here instead of as an unhandled stream error.
function openLog(logPath: string | undefined): WriteStream | undefined {
  if (logPath === undefined) return undefined;
  return createWriteStream(logPath, { fd: openSync(logPath, "w") });
}

// Never bypassPermissions, and never `cswap switch`: the developer's active account stays theirs.
function commandArgs(request: StepRequest): string[] {
  const args = [
    "run",
    String(request.account),
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
    JSON.stringify(request.jsonSchema),
    "--settings",
    JSON.stringify(settingsOf(request)),
  ];
  if (request.resumeSessionId) args.push("--resume", request.resumeSessionId);
  if (request.allowedTools.length > 0) {
    args.push("--allowedTools", ...request.allowedTools);
  }
  return args;
}

// Settings layered on the workspace's own, registering the hook that answers the prompt a .claude/ skill or agent write raises.
function settingsOf({ cwd, allowedWriteGlobs }: StepRequest): object {
  const hookArgs: SkillWriteHookArgs = {
    workspaceRoot: cwd,
    allowedGlobs: allowedWriteGlobs,
  };
  const command = ["node", skillWriteHookPath, JSON.stringify(hookArgs)].map(
    shellQuoted,
  );
  return {
    hooks: {
      PermissionRequest: [
        {
          matcher: "Edit|Write",
          hooks: [{ type: "command", command: command.join(" ") }],
        },
      ],
    },
  };
}

function shellQuoted(word: string): string {
  return `'${word.replaceAll("'", "'\\''")}'`;
}
