import { readFileSync } from "node:fs";

import {
  type HeadlessRun,
  projectSandboxOf,
  runStreaming,
  streamJson,
} from "./headlessProbe.ts";

export type CommandOutcome =
  | { command: string; status: "ran" | "not run" }
  | { command: string; status: "stopped"; error: string };

export interface SandboxSettings {
  sandbox: Record<string, unknown>;
  permissions?: { allow: string[] };
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
    return this._runUnder(
      cwd,
      commandsPath,
      sandboxSettings(projectSandboxOf(cwd)),
    );
  }

  // The folder's excluded commands kept, to see which calls Claude Code lets out of the box; an allow rule runs one unprompted, as nobody answers a prompt.
  async runKeepingExcluded(
    cwd: string,
    commandsPath: string,
  ): Promise<SandboxReport> {
    const project = projectSandboxOf(cwd);
    const { sandbox } = sandboxSettings(project);
    return this._runUnder(cwd, commandsPath, {
      sandbox: { ...sandbox, excludedCommands: project.excludedCommands },
      permissions: { allow: ["Bash"] },
    });
  }

  private async _runUnder(
    cwd: string,
    commandsPath: string,
    settings: SandboxSettings,
  ): Promise<SandboxReport> {
    const commands = commandList(readFileSync(commandsPath, "utf8"));
    const { exitCode, stderr, events } = await runStreaming({
      claudePath: this.claudePath,
      cwd,
      args: sandboxLaunch(commands, settings),
      label: `The sandbox probe session in ${cwd}`,
    });
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

// Only the folder's sandbox block, with no escape hatch or excluded commands: its hooks would refuse some commands before the box saw them, and which commands need excluding is what the probe finds.
// Sandboxed calls are allowed outright because the session has no permission rules or prompts, so the box is the only thing that can stop one.
function sandboxSettings(project: Record<string, unknown>): SandboxSettings {
  const { excludedCommands: _excluded, ...sandbox } = project;
  return {
    sandbox: {
      ...sandbox,
      allowUnsandboxedCommands: false,
      autoAllowBashIfSandboxed: true,
    },
  };
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

// A command listed twice matches the session's calls of it in order.
function commandOutcomes(
  events: unknown[],
  commands: string[],
): CommandOutcome[] {
  const calls = bashCalls(events);
  const results = streamJson.toolResults(events);
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

function bashCalls(events: unknown[]): BashCall[] {
  return events
    .flatMap((event) => streamJson.contentBlocks(event, "tool_use"))
    .flatMap((block) => {
      if (block.name !== "Bash" || typeof block.input?.command !== "string") {
        return [];
      }
      return [{ id: String(block.id), command: block.input.command.trim() }];
    });
}

// The Bash tool heads a failed command's output with its exit code, which says less than the line after it.
function firstErrorLine(text: string): string | undefined {
  return text
    .split("\n")
    .map((line) => line.trim())
    .find((line) => line !== "" && !/^Exit code \d+$/.test(line));
}
