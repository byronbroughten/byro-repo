// The one-turn headless session SessionProbe.ts, SandboxProbe.ts and InjectionProbe.ts launch, and the readers of its folder's sandbox block and stream-json events.
import { spawn } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

export interface HeadlessRun {
  exitCode: number | null;
  stdout: string;
  stderr: string;
}

export interface StreamingLaunch {
  claudePath: string;
  cwd: string;
  args: string[];
  label: string;
}

export interface StreamedRun {
  exitCode: HeadlessRun["exitCode"];
  stderr: string;
  events: unknown[];
}

export interface ContentBlock {
  type?: unknown;
  id?: unknown;
  name?: unknown;
  input?: { command?: unknown };
  tool_use_id?: unknown;
  is_error?: unknown;
  content?: unknown;
}

// Each probe's session needs no recall afterwards and no more model than following one prompt.
const headlessArgs = ["--model", "haiku", "--no-session-persistence"] as const;

export async function runHeadless(
  claudePath: string,
  cwd: string,
  args: string[],
): Promise<HeadlessRun> {
  const child = spawn(claudePath, [...args, ...headlessArgs], {
    cwd,
    stdio: ["ignore", "pipe", "pipe"],
  });
  let stdout = "";
  let stderr = "";
  child.stdout.on("data", (chunk) => (stdout += chunk));
  child.stderr.on("data", (chunk) => (stderr += chunk));
  const exitCode = await new Promise<number | null>((resolve, reject) => {
    child.on("error", reject);
    child.on("close", resolve);
  });
  return { exitCode, stdout, stderr };
}

export function projectSandboxOf(cwd: string): Record<string, unknown> {
  const path = join(cwd, ".claude", "settings.json");
  if (!existsSync(path)) throw new Error(`${path} doesn't exist`);
  const project = JSON.parse(readFileSync(path, "utf8")) as {
    sandbox?: Record<string, unknown>;
  };
  if (project.sandbox === undefined) {
    throw new Error(`${path} has no sandbox block`);
  }
  return project.sandbox;
}

// A stream-json session's run, its events read and a run that printed none refused, naming the session by its label.
export async function runStreaming({
  claudePath,
  cwd,
  args,
  label,
}: StreamingLaunch): Promise<StreamedRun> {
  const { exitCode, stdout, stderr } = await runHeadless(claudePath, cwd, args);
  const events = streamJson.events(stdout);
  if (events.length === 0) {
    throw new Error(
      `${label} exited with ${exitCode} and printed no events: ${stderr.trim()}`,
    );
  }
  return { exitCode, stderr, events };
}

export const streamJson = {
  events(stdout: string): unknown[] {
    return stdout.split("\n").flatMap((line) => {
      try {
        return [JSON.parse(line) as unknown];
      } catch {
        return [];
      }
    });
  },

  contentBlocks(event: unknown, type: string): ContentBlock[] {
    const message = (event as { message?: { content?: unknown } }).message;
    if (!Array.isArray(message?.content)) return [];
    return (message.content as ContentBlock[]).filter(
      (block) => block.type === type,
    );
  },
};
