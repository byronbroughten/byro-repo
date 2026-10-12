import { spawn } from "node:child_process";
import { createWriteStream } from "node:fs";
import { createInterface } from "node:readline";

import type { AgentStep, StepRequest, StepResult } from "./AgentStep.ts";
import { StepStream } from "./StepStream.ts";

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
    const child = spawn(this.cswapPath, commandArgs(request), {
      cwd: request.cwd,
      stdio: ["ignore", "pipe", "inherit"],
    });
    // Resolved, not rejected, so a spawn error waits for the read loop instead of going unhandled.
    const exited = new Promise<Error | undefined>((resolve) => {
      child.on("error", resolve);
      child.on("close", () => resolve(undefined));
    });
    const log = request.logPath && createWriteStream(request.logPath);
    const stream = StepStream.init();
    for await (const line of createInterface({ input: child.stdout })) {
      if (log) log.write(`${line}\n`);
      stream.observeLine(line);
    }
    const spawnError = await exited;
    if (spawnError) throw spawnError;
    if (log) await new Promise((resolve) => log.end(resolve));
    return stream.toResult(request.account, request.jsonSchema);
  }
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
  ];
  if (request.resumeSessionId) args.push("--resume", request.resumeSessionId);
  if (request.allowedTools.length > 0) {
    args.push("--allowedTools", ...request.allowedTools);
  }
  return args;
}
