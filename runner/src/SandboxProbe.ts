import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { type HeadlessRun, runHeadless } from "./headlessProbe.ts";

export type CommandOutcome =
  | { command: string; status: "ran" | "not run" }
  | { command: string; status: "stopped"; error: string };

export interface SandboxSettings {
  sandbox: Record<string, unknown>;
}

export interface SandboxReport {
  settings: SandboxSettings;
  outcomes: CommandOutcome[];
  exitCode: HeadlessRun["exitCode"];
  stderr: string;
  events: unknown[];
}

interface BashCall {
  id: string;
  command: string;
}

interface BashResult {
  isError: boolean;
  text: string;
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
    const { exitCode, stdout, stderr } = await runHeadless(
      this.claudePath,
      cwd,
      sandboxLaunch(commands, settings),
    );
    const events = streamEvents(stdout);
    if (events.length === 0) {
      throw new Error(
        `The sandbox probe session in ${cwd} exited with ${exitCode} and printed no events: ${stderr.trim()}`,
      );
    }
    const outcomes = commandOutcomes(events, commands);
    return { settings, outcomes, exitCode, stderr, events };
  }
}

export function commandOutcomeText(outcome: CommandOutcome): string {
  if (outcome.status !== "stopped") {
    return `${outcome.status}: ${outcome.command}`;
  }
  return `${outcome.status}: ${outcome.command} (${outcome.error})`;
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
function sandboxSettings(cwd: string): SandboxSettings {
  const path = join(cwd, ".claude", "settings.json");
  if (!existsSync(path)) throw new Error(`${path} doesn't exist`);
  const project = JSON.parse(
    readFileSync(path, "utf8"),
  ) as Partial<SandboxSettings>;
  if (project.sandbox === undefined) {
    throw new Error(`${path} has no sandbox block`);
  }
  return { sandbox: { ...project.sandbox, allowUnsandboxedCommands: false } };
}

function sandboxLaunch(
  commands: string[],
  settings: SandboxSettings,
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
    "--output-format",
    "stream-json",
    "--verbose",
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

function streamEvents(stdout: string): unknown[] {
  return stdout.split("\n").flatMap((line) => {
    try {
      return [JSON.parse(line) as unknown];
    } catch {
      return [];
    }
  });
}

// A command listed twice matches the session's calls of it in order.
function commandOutcomes(
  events: unknown[],
  commands: string[],
): CommandOutcome[] {
  const calls = bashCalls(events);
  const results = bashResults(events);
  return commands.map((command, index) => {
    const occurrence = commands
      .slice(0, index)
      .filter((earlier) => earlier === command).length;
    const call = calls.filter((made) => made.command === command)[occurrence];
    const result = call === undefined ? undefined : results.get(call.id);
    if (result === undefined) return { command, status: "not run" };
    if (!result.isError) return { command, status: "ran" };
    const error = firstErrorLine(result.text) ?? "no output";
    return { command, status: "stopped", error };
  });
}

function contentBlocks(event: unknown, type: string): ContentBlock[] {
  const message = (event as { message?: { content?: unknown } }).message;
  if (!Array.isArray(message?.content)) return [];
  return (message.content as ContentBlock[]).filter(
    (block) => block.type === type,
  );
}

function bashCalls(events: unknown[]): BashCall[] {
  return events
    .flatMap((event) => contentBlocks(event, "tool_use"))
    .flatMap((block) => {
      if (block.name !== "Bash" || typeof block.input?.command !== "string") {
        return [];
      }
      return [{ id: String(block.id), command: block.input.command.trim() }];
    });
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
