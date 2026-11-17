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

// Stands in for claude: finds the invoked skill in the cwd's .claude/skills, runs its injected command as node rather than npm, and prints one stream-json event.
// HOOKED=1 passes the command through each PreToolUse hook from --settings first, as a Bash call; SKIP=1 runs nothing.
const fakeClaude = `#!/usr/bin/env node
import { execSync } from "node:child_process";
import { readFileSync } from "node:fs";
const args = process.argv.slice(2);
const prompt = args[args.indexOf("-p") + 1];
const settings = JSON.parse(args[args.indexOf("--settings") + 1]);
const name = prompt.startsWith("/") ? prompt.slice(1) : /skill (\\S+)\\./.exec(prompt)[1];
const skill = readFileSync(".claude/skills/" + name + "/SKILL.md", "utf8");
const command = /!\`([^\`]+)\`/.exec(skill)[1];
if (process.env.HOOKED === "1") {
  const input = JSON.stringify({ tool_name: "Bash", tool_input: { command } });
  for (const entry of settings.hooks.PreToolUse) {
    for (const hook of entry.hooks) execSync(hook.command, { input });
  }
}
if (process.env.SKIP !== "1") {
  execSync(command.replace(/^npm run brief --/, "node brief.mjs"));
}
console.log(JSON.stringify({ type: "result" }));
`;

let temp: string;
let folder: string;

beforeEach(() => {
  temp = realpathSync(mkdtempSync(join(tmpdir(), "injection-probe-test-")));
  folder = join(temp, "folder");
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
    ]);
    expect(report.outcomes[0]?.brief?.args).toEqual(["inject-plain"]);
    expect(report.outcomes.every((outcome) => outcome.brief)).toBe(true);
    expect(report.outcomes[0]?.hookCalls).toEqual([]);
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
    ]);
  });

  it("reports the Bash call a PreToolUse hook saw", async () => {
    process.env.HOOKED = "1";

    const report = await probe().run(folder);

    expect(firstOutcome(report).hookCalls).toEqual([
      { toolName: "Bash", command: "npm run brief -- inject-plain" },
    ]);
    expect(injectionOutcomeText(firstOutcome(report))).toContain(
      "PreToolUse saw Bash npm run brief -- inject-plain",
    );
  });

  it("reports an injected command that never ran", async () => {
    process.env.SKIP = "1";

    const report = await probe().run(folder);

    expect(firstOutcome(report).brief).toBeUndefined();
    expect(injectionOutcomeText(firstOutcome(report))).toBe(
      "inject-plain (allowed-tools: none) by slash command: not run; no PreToolUse call",
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

    expect(report.permissions).toEqual({ allow: ["Skill"] });
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
