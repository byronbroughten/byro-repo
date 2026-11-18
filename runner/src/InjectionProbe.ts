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

export type InvokedBy =
  "slash command" | "Skill tool" | "Skill tool with no Skill allow rule";

interface InjectionSkill {
  name: string;
  allowedTools: string | undefined;
}

// Whether the brief could list and write `claude-guardrails/` under the hooks' tmpdir, where the read-first gate keeps its markers.
export interface MarkerFolderAccess {
  path: string;
  read: string;
  write: string;
}

// What the throwaway folder's brief script saw when an injected command ran it: `ps` is refused inside the box.
export interface BriefRun {
  args: string[];
  ps: string;
  tmpdir: string | undefined;
  sessionIds: Record<string, string>;
  markerFolder: MarkerFolderAccess | undefined;
}

export interface HookCall {
  toolName: string;
  command: string | undefined;
}

// What a hook saw of its own session: the first PreToolUse call's, else SessionStart's.
export interface HookSession {
  event: string;
  tmpdir: string;
  sessionId: string | undefined;
}

export type SkillCall =
  { status: "ran" | "unanswered" } | { status: "denied"; error: string };

export interface InjectionOutcome {
  skill: string;
  allowedTools: string | undefined;
  invokedBy: InvokedBy;
  brief: BriefRun | undefined;
  hook: HookSession | undefined;
  hookCalls: HookCall[];
  skillCall: SkillCall | undefined;
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

interface HookLine extends HookCall {
  event: string;
  tmpdir: string;
  sessionId: string | undefined;
}

// A skill with allowed-tools asks before the Skill tool runs it, and nobody answers; allowing Skill frees no Bash call. The last run takes the rule out to see that denial again.
const permissions: Record<InvokedBy, { allow: string[] }> = {
  "slash command": { allow: ["Skill"] },
  "Skill tool": { allow: ["Skill"] },
  "Skill tool with no Skill allow rule": { allow: [] },
};

const injectionSkills: InjectionSkill[] = [
  { name: "inject-plain", allowedTools: undefined },
  { name: "inject-npm-space", allowedTools: "Bash(npm run brief *)" },
  { name: "inject-npm-colon", allowedTools: "Bash(npm run brief:*)" },
  { name: "inject-bash", allowedTools: "Bash" },
];

// Every skill by both routes with Skill allowed, then one skill with allowed-tools through the Skill tool without.
const runs = {
  allowed: ["slash command", "Skill tool"],
  denied: {
    skill: { name: "inject-npm-space", allowedTools: "Bash(npm run brief *)" },
    invokedBy: "Skill tool with no Skill allow rule",
  },
} as const satisfies {
  allowed: InvokedBy[];
  denied: { skill: InjectionSkill; invokedBy: InvokedBy };
};

// The throwaway folder's two scripts: the brief an injected command runs, and the SessionStart and PreToolUse hook that logs what it sees.
const folderScripts = {
  brief: [
    'import { execFileSync } from "node:child_process";',
    'import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";',
    'import { join } from "node:path";',
    "let ps;",
    "try {",
    '  ps = execFileSync("ps", ["-p", "1", "-o", "comm="], { encoding: "utf8", stdio: "pipe" }).trim();',
    "} catch (error) {",
    "  ps = `refused: ${String(error.stderr || error.message).trim()}`;",
    "}",
    "const args = process.argv.slice(2);",
    'const hookLog = new URL("./hook.jsonl", import.meta.url);',
    'const hook = existsSync(hookLog) ? JSON.parse(readFileSync(hookLog, "utf8").split("\\n")[0]) : undefined;',
    "const sessionIds = {};",
    "if (args[1] !== undefined) sessionIds.argument = args[1];",
    "for (const [name, value] of Object.entries(process.env)) {",
    "  if (/session/i.test(name) || (hook?.sessionId && value?.includes(hook.sessionId))) sessionIds[name] = value;",
    "}",
    "function refusal(error) {",
    "  return `refused: ${error.code ?? error.message}`;",
    "}",
    "let markerFolder;",
    "if (hook !== undefined) {",
    '  const path = join(hook.tmpdir, "claude-guardrails");',
    '  let read = "read";',
    "  try {",
    "    readdirSync(path);",
    "  } catch (error) {",
    '    read = error.code === "ENOENT" ? "absent" : refusal(error);',
    "  }",
    '  let write = "wrote";',
    "  try {",
    "    mkdirSync(path, { recursive: true });",
    "    const marker = join(path, `injection-probe-${process.pid}.marker`);",
    '    writeFileSync(marker, "");',
    "    rmSync(marker);",
    "  } catch (error) {",
    "    write = refusal(error);",
    "  }",
    "  markerFolder = { path, read, write };",
    "}",
    'writeFileSync(new URL("./brief.json", import.meta.url), JSON.stringify({ args, ps, tmpdir: process.env.TMPDIR, sessionIds, markerFolder }));',
    'console.log(`brief ran: ${args.join(" ")}; ps: ${ps}`);',
  ].join("\n"),
  hook: [
    'import { appendFileSync, readFileSync } from "node:fs";',
    'import { tmpdir } from "node:os";',
    "const input = JSON.parse(readFileSync(0, 'utf8'));",
    "const line = { event: input.hook_event_name, toolName: input.tool_name, command: input.tool_input?.command, sessionId: input.session_id, tmpdir: tmpdir() };",
    "appendFileSync(process.argv[2], JSON.stringify(line) + '\\n');",
  ].join("\n"),
} as const;

interface InjectionRun {
  folder: string;
  sandbox: Record<string, unknown>;
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
      const outcomes: InjectionOutcome[] = [];
      for (const skill of injectionSkills) {
        for (const invokedBy of runs.allowed) {
          outcomes.push(
            await this._probe({ folder, sandbox, skill, invokedBy }),
          );
        }
      }
      outcomes.push(await this._probe({ folder, sandbox, ...runs.denied }));
      return { sandbox, permissions, outcomes };
    } finally {
      rmSync(folder, { recursive: true, force: true });
    }
  }

  private async _probe({
    folder,
    sandbox,
    skill,
    invokedBy,
  }: InjectionRun): Promise<InjectionOutcome> {
    const briefPath = join(folder, "brief.json");
    const hookLog = join(folder, "hook.jsonl");
    rmSync(briefPath, { force: true });
    rmSync(hookLog, { force: true });
    const settings = probeSettings({
      folder,
      sandbox,
      permissions: permissions[invokedBy],
    });
    const { exitCode, stderr, events } = await runStreaming({
      claudePath: this.claudePath,
      cwd: folder,
      args: injectionLaunch({ prompt: promptOf(skill, invokedBy), settings }),
      label: `The injection probe session for ${skill.name} by ${invokedBy}`,
    });
    const hookLines = hookLinesOf(hookLog);
    return {
      skill: skill.name,
      allowedTools: skill.allowedTools,
      invokedBy,
      brief: briefRunOf(briefPath),
      hook: hookSessionOf(hookLines),
      hookCalls: hookLines
        .filter(({ event }) => event === "PreToolUse")
        .map(({ toolName, command }) => ({ toolName, command })),
      skillCall: skillCallOf(events),
      modelTools: modelToolsOf(events),
      exitCode,
      stderr,
      events,
    };
  }
}

export function injectionOutcomeText(outcome: InjectionOutcome): string {
  const head = `${outcome.skill} (allowed-tools: ${outcome.allowedTools ?? "none"}) by ${outcome.invokedBy}`;
  const parts: string[] = [];
  if (outcome.invokedBy !== "slash command") {
    parts.push(skillCallText(outcome.skillCall));
  }
  parts.push(briefText(outcome));
  if (outcome.hook !== undefined) {
    parts.push(`${outcome.hook.event} hook's tmpdir ${outcome.hook.tmpdir}`);
  } else {
    parts.push("no hook reported its tmpdir");
  }
  if (outcome.brief?.markerFolder !== undefined) {
    const { path, read, write } = outcome.brief.markerFolder;
    parts.push(`marker folder ${path} ${read}, ${write}`);
  }
  if (outcome.hookCalls.length > 0) {
    parts.push(
      `PreToolUse saw ${outcome.hookCalls.map(hookCallText).join(", ")}`,
    );
  } else {
    parts.push("no PreToolUse call");
  }
  return `${head}: ${parts.join("; ")}`;
}

function skillCallText(skillCall: SkillCall | undefined): string {
  if (skillCall === undefined) return "no Skill call";
  if (skillCall.status === "ran") return "Skill call ran";
  if (skillCall.status === "unanswered") return "Skill call had no result";
  return `Skill call denied (${skillCall.error})`;
}

function briefText({ brief, hook }: InjectionOutcome): string {
  if (brief === undefined) return "not run";
  return `ran, ps ${brief.ps}, ${sessionIdText(brief, hook)}`;
}

// The brief names where it found anything session-like; the hook's own session ID says which of them is the real one.
function sessionIdText(brief: BriefRun, hook: HookSession | undefined): string {
  const found = Object.entries(brief.sessionIds);
  if (hook?.sessionId === undefined) {
    return `no hook session ID to compare (brief saw ${foundText(found)})`;
  }
  const sessionId = hook.sessionId;
  const seenIn = found
    .filter(([, value]) => value.includes(sessionId))
    .map(([name]) => name);
  if (seenIn.length > 0) return `session ID seen in ${seenIn.join(", ")}`;
  return `session ID not seen (brief saw ${foundText(found)})`;
}

function foundText(found: [string, string][]): string {
  if (found.length === 0) return "nothing";
  return found.map(([name, value]) => `${name}=${value}`).join(", ");
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

// `${CLAUDE_SESSION_ID}` is Claude Code's skill substitution, so the brief's second argument shows whether the injection gets it.
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
    `Brief: !\`npm run brief -- ${name} \${CLAUDE_SESSION_ID}\``,
    "",
    "Reply with the word ok. Call no tool.",
    "",
  ].join("\n");
}

// The folder's sandbox block as it is, excludedCommands kept as the recorded runs had them, and a SessionStart and PreToolUse hook on every tool that logs what it sees.
function probeSettings({
  folder,
  sandbox,
  permissions: runPermissions,
}: {
  folder: string;
  sandbox: Record<string, unknown>;
  permissions: { allow: string[] };
}): string {
  const command = `node ${JSON.stringify(join(folder, "hook.mjs"))} ${JSON.stringify(join(folder, "hook.jsonl"))}`;
  const hooks = [{ type: "command", command }];
  return JSON.stringify({
    sandbox,
    permissions: runPermissions,
    hooks: {
      SessionStart: [{ hooks }],
      PreToolUse: [{ matcher: "*", hooks }],
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

function hookLinesOf(path: string): HookLine[] {
  if (!existsSync(path)) return [];
  return readFileSync(path, "utf8")
    .split("\n")
    .filter((line) => line !== "")
    .map((line) => JSON.parse(line) as HookLine);
}

function hookSessionOf(lines: HookLine[]): HookSession | undefined {
  const line = lines.find(({ event }) => event === "PreToolUse") ?? lines.at(0);
  if (line === undefined) return undefined;
  return { event: line.event, tmpdir: line.tmpdir, sessionId: line.sessionId };
}

// The session's first Skill call and its result: an error result is a denial, as nobody answers a prompt.
function skillCallOf(events: unknown[]): SkillCall | undefined {
  const call = events
    .flatMap((event) => streamJson.contentBlocks(event, "tool_use"))
    .find((block) => block.name === "Skill");
  if (call === undefined) return undefined;
  const result = streamJson.toolResults(events).get(String(call.id));
  if (result === undefined) return { status: "unanswered" };
  if (!result.isError) return { status: "ran" };
  return { status: "denied", error: result.text.trim() };
}

function modelToolsOf(events: unknown[]): string[] {
  return events
    .flatMap((event) => streamJson.contentBlocks(event, "tool_use"))
    .map((block) => String(block.name));
}
