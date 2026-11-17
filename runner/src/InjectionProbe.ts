import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  type HeadlessRun,
  projectSandboxOf,
  runStreaming,
  streamJson,
} from "./headlessProbe.ts";

export type InvokedBy = "slash command" | "Skill tool";

interface InjectionSkill {
  name: string;
  allowedTools: string | undefined;
}

// What the throwaway folder's brief script saw when an injected command ran it: `ps` is refused inside the box.
export interface BriefRun {
  args: string[];
  ps: string;
  tmpdir: string | undefined;
}

export interface HookCall {
  toolName: string;
  command: string | undefined;
}

export interface InjectionOutcome {
  skill: string;
  allowedTools: string | undefined;
  invokedBy: InvokedBy;
  brief: BriefRun | undefined;
  hookCalls: HookCall[];
  modelTools: string[];
  exitCode: HeadlessRun["exitCode"];
  stderr: string;
  events: unknown[];
}

export interface InjectionReport {
  sandbox: Record<string, unknown>;
  permissions: typeof permissions;
  outcomes: InjectionOutcome[];
}

// A skill with allowed-tools asks before the Skill tool runs it, and nobody answers; allowing Skill frees no Bash call.
const permissions = { allow: ["Skill"] };

const invocations: InvokedBy[] = ["slash command", "Skill tool"];

const injectionSkills: InjectionSkill[] = [
  { name: "inject-plain", allowedTools: undefined },
  { name: "inject-npm-space", allowedTools: "Bash(npm run brief *)" },
  { name: "inject-npm-colon", allowedTools: "Bash(npm run brief:*)" },
  { name: "inject-bash", allowedTools: "Bash" },
];

// The throwaway folder's two scripts: the brief an injected command runs, and the PreToolUse hook that logs each call it sees.
const folderScripts = {
  brief: [
    'import { execFileSync } from "node:child_process";',
    'import { writeFileSync } from "node:fs";',
    "let ps;",
    "try {",
    '  ps = execFileSync("ps", ["-p", "1", "-o", "comm="], { encoding: "utf8", stdio: "pipe" }).trim();',
    "} catch (error) {",
    "  ps = `refused: ${String(error.stderr || error.message).trim()}`;",
    "}",
    "const args = process.argv.slice(2);",
    'writeFileSync(new URL("./brief.json", import.meta.url), JSON.stringify({ args, ps, tmpdir: process.env.TMPDIR }));',
    'console.log(`brief ran: ${args.join(" ")}; ps: ${ps}`);',
  ].join("\n"),
  hook: [
    'import { appendFileSync, readFileSync } from "node:fs";',
    "const input = JSON.parse(readFileSync(0, 'utf8'));",
    "const call = { toolName: input.tool_name, command: input.tool_input?.command };",
    "appendFileSync(process.argv[2], JSON.stringify(call) + '\\n');",
  ].join("\n"),
} as const;

interface InjectionRun {
  folder: string;
  settings: string;
  skill: InjectionSkill;
  invokedBy: InvokedBy;
}

// Each skill runs in its own one-turn session in a throwaway folder under temp, so only `--settings` adds a hook and no repo file is written.
export class InjectionProbe {
  private readonly claudePath: string;

  constructor(claudePath: string) {
    this.claudePath = claudePath;
  }

  static init(claudePath = "claude"): InjectionProbe {
    return new InjectionProbe(claudePath);
  }

  async run(cwd: string): Promise<InjectionReport> {
    const sandbox = {
      ...projectSandboxOf(cwd),
      allowUnsandboxedCommands: false,
    };
    const folder = mkdtempSync(join(tmpdir(), "injection-probe-"));
    try {
      writeProject(folder);
      const settings = probeSettings(folder, sandbox);
      const outcomes: InjectionOutcome[] = [];
      for (const skill of injectionSkills) {
        for (const invokedBy of invocations) {
          outcomes.push(
            await this._probe({ folder, settings, skill, invokedBy }),
          );
        }
      }
      return { sandbox, permissions, outcomes };
    } finally {
      rmSync(folder, { recursive: true, force: true });
    }
  }

  private async _probe({
    folder,
    settings,
    skill,
    invokedBy,
  }: InjectionRun): Promise<InjectionOutcome> {
    const briefPath = join(folder, "brief.json");
    const hookLog = join(folder, "hook.jsonl");
    rmSync(briefPath, { force: true });
    rmSync(hookLog, { force: true });
    const { exitCode, stderr, events } = await runStreaming({
      claudePath: this.claudePath,
      cwd: folder,
      args: injectionLaunch({ prompt: promptOf(skill, invokedBy), settings }),
      label: `The injection probe session for ${skill.name} by ${invokedBy}`,
    });
    return {
      skill: skill.name,
      allowedTools: skill.allowedTools,
      invokedBy,
      brief: briefRunOf(briefPath),
      hookCalls: hookCallsOf(hookLog),
      modelTools: modelToolsOf(events),
      exitCode,
      stderr,
      events,
    };
  }
}

export function injectionOutcomeText(outcome: InjectionOutcome): string {
  const head = `${outcome.skill} (allowed-tools: ${outcome.allowedTools ?? "none"}) by ${outcome.invokedBy}`;
  let ran = "not run";
  if (outcome.brief !== undefined) ran = `ran, ps ${outcome.brief.ps}`;
  let hooks = "no PreToolUse call";
  if (outcome.hookCalls.length > 0) {
    hooks = `PreToolUse saw ${outcome.hookCalls.map(hookCallText).join(", ")}`;
  }
  return `${head}: ${ran}; ${hooks}`;
}

function hookCallText({ toolName, command }: HookCall): string {
  if (command === undefined) return toolName;
  return `${toolName} ${command}`;
}

function writeProject(folder: string): void {
  writeFileSync(
    join(folder, "package.json"),
    JSON.stringify({ private: true, scripts: { brief: "node brief.mjs" } }),
  );
  writeFileSync(join(folder, "brief.mjs"), folderScripts.brief);
  writeFileSync(join(folder, "hook.mjs"), folderScripts.hook);
  for (const skill of injectionSkills) {
    const skillFolder = join(folder, ".claude", "skills", skill.name);
    mkdirSync(skillFolder, { recursive: true });
    writeFileSync(join(skillFolder, "SKILL.md"), skillText(skill));
  }
}

function skillText({ name, allowedTools }: InjectionSkill): string {
  const frontMatter = [
    "---",
    `name: ${name}`,
    "description: A throwaway skill the injection probe invokes.",
  ];
  if (allowedTools !== undefined) {
    frontMatter.push(`allowed-tools: ${allowedTools}`);
  }
  return [
    ...frontMatter,
    "---",
    "",
    `Brief: !\`npm run brief -- ${name}\``,
    "",
    "Reply with the word ok. Call no tool.",
    "",
  ].join("\n");
}

// The folder's sandbox block as it is, excludedCommands kept as the recorded runs had them, and a PreToolUse hook on every tool that logs what it sees.
function probeSettings(
  folder: string,
  sandbox: Record<string, unknown>,
): string {
  const command = `node ${JSON.stringify(join(folder, "hook.mjs"))} ${JSON.stringify(join(folder, "hook.jsonl"))}`;
  return JSON.stringify({
    sandbox,
    permissions,
    hooks: {
      PreToolUse: [{ matcher: "*", hooks: [{ type: "command", command }] }],
    },
  });
}

function promptOf({ name }: InjectionSkill, invokedBy: InvokedBy): string {
  if (invokedBy === "slash command") return `/${name}`;
  return `Call the Skill tool once, with the skill ${name}. Then reply with the word ok, calling no other tool.`;
}

// Project settings only, so the user's permission rules can't allow the brief, and no prompt, as nobody answers one.
function injectionLaunch({
  prompt,
  settings,
}: {
  prompt: string;
  settings: string;
}): string[] {
  return [
    "-p",
    prompt,
    "--settings",
    settings,
    "--setting-sources",
    "project",
    "--tools",
    "Bash,Skill",
    "--permission-prompts",
    "none",
    "--max-turns",
    "3",
    "--output-format",
    "stream-json",
    "--verbose",
  ];
}

function briefRunOf(path: string): BriefRun | undefined {
  if (!existsSync(path)) return undefined;
  return JSON.parse(readFileSync(path, "utf8")) as BriefRun;
}

function hookCallsOf(path: string): HookCall[] {
  if (!existsSync(path)) return [];
  return readFileSync(path, "utf8")
    .split("\n")
    .filter((line) => line !== "")
    .map((line) => JSON.parse(line) as HookCall);
}

function modelToolsOf(events: unknown[]): string[] {
  return events
    .flatMap((event) => streamJson.contentBlocks(event, "tool_use"))
    .map((block) => String(block.name));
}
