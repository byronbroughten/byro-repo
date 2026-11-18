import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  type InjectionOutcome,
  injectionOutcomeText,
  InjectionProbe,
  type InjectionReport,
} from "./InjectionProbe.ts";

// Stands in for claude: runs each --settings SessionStart hook with HOOK_TMPDIR as its TMPDIR, denies a Skill call to a skill with allowed-tools when Skill isn't allowed, and runs the skill's injected command, the session ID substituted, as node; HOOKED=1 first passes it through each PreToolUse hook, SKIP=1 runs nothing.
const fakeClaude = `#!/usr/bin/env node
import { execSync } from "node:child_process";
import { readFileSync } from "node:fs";
const sessionId = "fake-session-id";
const args = process.argv.slice(2);
const prompt = args[args.indexOf("-p") + 1];
const settings = JSON.parse(args[args.indexOf("--settings") + 1]);
const viaSkill = !prompt.startsWith("/");
const name = viaSkill ? /skill (\\S+)\\./.exec(prompt)[1] : prompt.slice(1);
const skill = readFileSync(".claude/skills/" + name + "/SKILL.md", "utf8");
const command = /!\`([^\`]+)\`/.exec(skill)[1].replace("\${CLAUDE_SESSION_ID}", sessionId);
const env = { ...process.env, TMPDIR: process.env.HOOK_TMPDIR };
function runHooks(event, input) {
  for (const entry of settings.hooks[event]) {
    for (const hook of entry.hooks) {
      execSync(hook.command, { env, input: JSON.stringify({ hook_event_name: event, session_id: sessionId, ...input }) });
    }
  }
}
function print(content) {
  console.log(JSON.stringify({ type: "assistant", message: { content: [content] } }));
}
runHooks("SessionStart", {});
if (viaSkill) print({ type: "tool_use", id: "skill-1", name: "Skill", input: { skill: name } });
const isDenied = viaSkill && !settings.permissions.allow.includes("Skill") && skill.includes("allowed-tools:");
if (isDenied) {
  print({ type: "tool_result", tool_use_id: "skill-1", is_error: true, content: "Permission to use Skill has been denied." });
} else {
  if (process.env.HOOKED === "1") {
    runHooks("PreToolUse", { tool_name: "Bash", tool_input: { command } });
  }
  if (process.env.SKIP !== "1") {
    execSync(command.replace(/^npm run brief --/, "node brief.mjs"));
  }
  if (viaSkill) print({ type: "tool_result", tool_use_id: "skill-1", content: "Launching skill" });
}
console.log(JSON.stringify({ type: "result" }));
`;

let temp: string;
let folder: string;
let hookTemp: string;

beforeEach(() => {
  temp = realpathSync(mkdtempSync(join(tmpdir(), "injection-probe-test-")));
  folder = join(temp, "folder");
  hookTemp = join(temp, "hook-temp");
  mkdirSync(hookTemp);
  process.env.HOOK_TMPDIR = hookTemp;
  mkdirSync(join(folder, ".claude"), { recursive: true });
  writeFileSync(
    join(folder, ".claude", "settings.json"),
    JSON.stringify({ sandbox: { enabled: true, excludedCommands: ["ps"] } }),
  );
  delete process.env.HOOKED;
  delete process.env.SKIP;
});

afterEach(() => {
  rmSync(temp, { recursive: true, force: true });
  delete process.env.HOOKED;
  delete process.env.SKIP;
  delete process.env.HOOK_TMPDIR;
});

function probe(): InjectionProbe {
  const path = join(temp, "claude.mjs");
  writeFileSync(path, fakeClaude);
  chmodSync(path, 0o755);
  return InjectionProbe.init(path);
}

function firstOutcome({ outcomes }: InjectionReport): InjectionOutcome {
  const [first] = outcomes;
  if (first === undefined) throw new Error("The report holds no outcome");
  return first;
}

function probeFolders(): string[] {
  return readdirSync(tmpdir()).filter(
    (name) =>
      name.startsWith("injection-probe-") &&
      !name.startsWith("injection-probe-test-"),
  );
}

describe("InjectionProbe", () => {
  it("reports the brief each skill's injected command ran, by slash command and through the Skill tool", async () => {
    const report = await probe().run(folder);

    expect(
      report.outcomes.map(({ skill, invokedBy }) => `${skill} ${invokedBy}`),
    ).toEqual([
      "inject-plain slash command",
      "inject-plain Skill tool",
      "inject-npm-space slash command",
      "inject-npm-space Skill tool",
      "inject-npm-colon slash command",
      "inject-npm-colon Skill tool",
      "inject-bash slash command",
      "inject-bash Skill tool",
      "inject-npm-space Skill tool with no Skill allow rule",
    ]);
    expect(report.outcomes[0]?.brief?.args).toEqual([
      "inject-plain",
      "fake-session-id",
    ]);
    expect(report.outcomes.slice(0, -1).every((outcome) => outcome.brief)).toBe(
      true,
    );
    expect(report.outcomes[0]?.hookCalls).toEqual([]);
  });

  it("reports the session ID the injected command saw beside the one the hooks saw", async () => {
    const report = await probe().run(folder);

    expect(firstOutcome(report).brief?.sessionIds).toMatchObject({
      argument: "fake-session-id",
    });
    expect(firstOutcome(report).hook?.sessionId).toBe("fake-session-id");
    expect(injectionOutcomeText(firstOutcome(report))).toContain(
      "session ID seen in argument",
    );
  });

  it("reports the hook's tmpdir and whether the injected command reads and writes claude-guardrails under it", async () => {
    const markerFolder = join(hookTemp, "claude-guardrails");

    const report = await probe().run(folder);

    expect(firstOutcome(report).hook?.tmpdir).toBe(hookTemp);
    expect(firstOutcome(report).brief?.markerFolder).toEqual({
      path: markerFolder,
      read: "absent",
      write: "wrote",
    });
    expect(report.outcomes[1]?.brief?.markerFolder?.read).toBe("read");
    expect(readdirSync(markerFolder)).toEqual([]);
    expect(injectionOutcomeText(firstOutcome(report))).toContain(
      `SessionStart hook's tmpdir ${hookTemp}; marker folder ${markerFolder} absent, wrote`,
    );
  });

  it("names the PreToolUse hook's tmpdir once that hook saw a call", async () => {
    process.env.HOOKED = "1";

    const report = await probe().run(folder);

    expect(firstOutcome(report).hook?.event).toBe("PreToolUse");
    expect(injectionOutcomeText(firstOutcome(report))).toContain(
      `PreToolUse hook's tmpdir ${hookTemp}`,
    );
  });

  it("reports a Skill call with no Skill allow rule as denied, beside the allowed ones that ran", async () => {
    const report = await probe().run(folder);
    const last = report.outcomes.at(-1);
    if (last === undefined) throw new Error("The report holds no outcome");

    expect(last.skillCall).toEqual({
      status: "denied",
      error: "Permission to use Skill has been denied.",
    });
    expect(last.brief).toBeUndefined();
    expect(injectionOutcomeText(last)).toContain(
      "inject-npm-space (allowed-tools: Bash(npm run brief *)) by Skill tool with no Skill allow rule: Skill call denied (Permission to use Skill has been denied.); not run",
    );
    expect(report.outcomes[3]?.skillCall).toEqual({ status: "ran" });
    expect(injectionOutcomeText(firstOutcome(report))).not.toContain(
      "Skill call",
    );
  });

  it("names each skill's allowed-tools entry", async () => {
    const report = await probe().run(folder);

    expect(report.outcomes.map(({ allowedTools }) => allowedTools)).toEqual([
      undefined,
      undefined,
      "Bash(npm run brief *)",
      "Bash(npm run brief *)",
      "Bash(npm run brief:*)",
      "Bash(npm run brief:*)",
      "Bash",
      "Bash",
      "Bash(npm run brief *)",
    ]);
  });

  it("reports the Bash call a PreToolUse hook saw", async () => {
    process.env.HOOKED = "1";

    const report = await probe().run(folder);

    expect(firstOutcome(report).hookCalls).toEqual([
      {
        toolName: "Bash",
        command: "npm run brief -- inject-plain fake-session-id",
      },
    ]);
    expect(injectionOutcomeText(firstOutcome(report))).toContain(
      "PreToolUse saw Bash npm run brief -- inject-plain fake-session-id",
    );
  });

  it("reports an injected command that never ran", async () => {
    process.env.SKIP = "1";

    const report = await probe().run(folder);

    expect(firstOutcome(report).brief).toBeUndefined();
    expect(injectionOutcomeText(firstOutcome(report))).toBe(
      `inject-plain (allowed-tools: none) by slash command: not run; SessionStart hook's tmpdir ${hookTemp}; no PreToolUse call`,
    );
  });

  it("passes the folder's sandbox block with unsandboxed commands off", async () => {
    const report = await probe().run(folder);

    expect(report.sandbox).toEqual({
      enabled: true,
      excludedCommands: ["ps"],
      allowUnsandboxedCommands: false,
    });
  });

  it("allows the Skill tool and no Bash call, so only the skill's allowed-tools can free its injection", async () => {
    const report = await probe().run(folder);

    expect(report.permissions).toEqual({
      "slash command": { allow: ["Skill"] },
      "Skill tool": { allow: ["Skill"] },
      "Skill tool with no Skill allow rule": { allow: [] },
    });
  });

  it("leaves its throwaway skills and folder nowhere but gone", async () => {
    const before = probeFolders();

    await probe().run(folder);

    expect(probeFolders()).toEqual(before);
    expect(existsSync(join(folder, ".claude", "skills"))).toBe(false);
  });

  it("throws when a session prints no events", async () => {
    const path = join(temp, "silent.mjs");
    writeFileSync(path, "#!/usr/bin/env node\n");
    chmodSync(path, 0o755);

    await expect(InjectionProbe.init(path).run(folder)).rejects.toThrow(
      "printed no events",
    );
  });
});
