import { spawn } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

export type SandboxStatus = "ran" | "stopped" | "not run";

export interface SandboxLine {
  command: string;
  status: SandboxStatus;
  // The first line of a stopped command's output.
  error: string | undefined;
}

export interface SandboxReport {
  settings: Record<string, unknown>;
  lines: SandboxLine[];
  // The session's stream-json events, in order.
  events: unknown[];
}

interface BashResult {
  isError: boolean;
  text: string;
}

// Claude Code 2.1.316 has no command that runs its sandbox runtime alone, so each command goes through one headless session's Bash tool.
export class SandboxProbe {
  private readonly claudePath: string;

  constructor(claudePath: string) {
    this.claudePath = claudePath;
  }

  static init(claudePath = "claude"): SandboxProbe {
    return new SandboxProbe(claudePath);
  }

  async run(cwd: string, commandsPath: string): Promise<SandboxReport> {
    const commands = commandList(readFileSync(commandsPath, "utf8"));
    const settings = sandboxSettings(cwd);
    const stdout = await runSession(
      this.claudePath,
      cwd,
      sandboxLaunch(commands, settings),
    );
    const events = streamEvents(stdout);
    if (events.length === 0) {
      throw new Error(`The sandbox probe session in ${cwd} printed no events`);
    }
    return { settings, lines: sandboxLines(events, commands), events };
  }
}

export function sandboxLineText(line: SandboxLine): string {
  if (line.error === undefined) return `${line.status}: ${line.command}`;
  return `${line.status}: ${line.command} (${line.error})`;
}

function commandList(text: string): string[] {
  const commands = text
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line !== "");
  if (commands.length === 0) {
    throw new Error("The command list holds no commands");
  }
  return commands;
}

// Only the folder's sandbox block, with no escape hatch: the folder's own hooks would refuse some commands before the box saw them.
function sandboxSettings(cwd: string): Record<string, unknown> {
  const path = join(cwd, ".claude", "settings.json");
  if (!existsSync(path)) throw new Error(`${path} doesn't exist`);
  const project = JSON.parse(readFileSync(path, "utf8")) as {
    sandbox?: Record<string, unknown>;
  };
  if (project.sandbox === undefined) {
    throw new Error(`${path} has no sandbox block`);
  }
  return { sandbox: { ...project.sandbox, allowUnsandboxedCommands: false } };
}

function sandboxLaunch(
  commands: string[],
  settings: Record<string, unknown>,
): string[] {
  return [
    "-p",
    sandboxPrompt(commands),
    "--settings",
    JSON.stringify(settings),
    "--setting-sources",
    "",
    "--tools",
    "Bash",
    "--permission-prompts",
    "none",
    "--max-turns",
    String(commands.length + 1),
    "--model",
    "haiku",
    "--output-format",
    "stream-json",
    "--verbose",
    "--no-session-persistence",
  ];
}

function sandboxPrompt(commands: string[]): string {
  return [
    "Run each shell command below with the Bash tool, in order, one call per command, exactly as given.",
    "Run each one once: never retry a command, change it, or disable the sandbox, even when it fails.",
    "After the last one, reply with the word done.",
    "",
    ...commands,
  ].join("\n");
}

async function runSession(
  claudePath: string,
  cwd: string,
  args: string[],
): Promise<string> {
  const child = spawn(claudePath, args, {
    cwd,
    stdio: ["ignore", "pipe", "ignore"],
  });
  let stdout = "";
  child.stdout.on("data", (chunk) => (stdout += chunk));
  await new Promise<void>((resolve, reject) => {
    child.on("error", reject);
    child.on("close", () => resolve());
  });
  return stdout;
}

function streamEvents(stdout: string): unknown[] {
  return stdout.split("\n").flatMap((line) => {
    try {
      return [JSON.parse(line) as unknown];
    } catch {
      return [];
    }
  });
}

function sandboxLines(events: unknown[], commands: string[]): SandboxLine[] {
  const calls = bashCalls(events);
  const results = bashResults(events);
  return commands.map((command) => {
    const id = [...calls].find(([, called]) => called === command)?.[0];
    const result = id === undefined ? undefined : results.get(id);
    if (result === undefined) {
      return { command, status: "not run", error: undefined };
    }
    if (!result.isError) return { command, status: "ran", error: undefined };
    return { command, status: "stopped", error: firstErrorLine(result.text) };
  });
}

interface ContentBlock {
  type?: unknown;
  id?: unknown;
  name?: unknown;
  input?: { command?: unknown };
  tool_use_id?: unknown;
  is_error?: unknown;
  content?: unknown;
}

function contentBlocks(event: unknown, type: string): ContentBlock[] {
  const message = (event as { type?: unknown; message?: { content?: unknown } })
    .message;
  if (!Array.isArray(message?.content)) return [];
  return (message.content as ContentBlock[]).filter(
    (block) => block.type === type,
  );
}

// Each Bash call's tool-use id and command, in call order.
function bashCalls(events: unknown[]): Map<string, string> {
  return events
    .flatMap((event) => contentBlocks(event, "tool_use"))
    .reduce((calls, block) => {
      if (block.name === "Bash" && typeof block.input?.command === "string") {
        calls.set(String(block.id), block.input.command.trim());
      }
      return calls;
    }, new Map<string, string>());
}

function bashResults(events: unknown[]): Map<string, BashResult> {
  return events
    .flatMap((event) => contentBlocks(event, "tool_result"))
    .reduce((results, block) => {
      results.set(String(block.tool_use_id), {
        isError: block.is_error === true,
        text: resultText(block.content),
      });
      return results;
    }, new Map<string, BashResult>());
}

function resultText(content: unknown): string {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  return (content as { text?: unknown }[])
    .map((part) => (typeof part.text === "string" ? part.text : ""))
    .join("\n");
}

// The Bash tool heads a failed command's output with its exit code, which says less than the line after it.
function firstErrorLine(text: string): string | undefined {
  return text
    .split("\n")
    .map((line) => line.trim())
    .find((line) => line !== "" && !/^Exit code \d+$/.test(line));
}
