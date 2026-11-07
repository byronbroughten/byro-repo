import {
  chmodSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { commandOutcomeText, SandboxProbe } from "./SandboxProbe.ts";

// Stands in for claude: records its args, then answers each prompt command with a Bash call, failing the ones that say "denied" or repeat an earlier one, and skipping the ones that say "skipped".
const fakeClaude = `#!/usr/bin/env node
import { writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
const args = process.argv.slice(2);
writeFileSync(join(dirname(process.argv[1]), "args.json"), JSON.stringify(args));
const prompt = args[args.indexOf("-p") + 1];
const commands = prompt.split("\\n\\n")[1].split("\\n");
console.log("not json");
commands.forEach((command, index) => {
  if (command.includes("skipped")) return;
  const id = "toolu_" + index;
  const isError = command.includes("denied") || commands.indexOf(command) !== index;
  const content = isError ? "Exit code 1\\n" + command + ": Operation not permitted\\nmore" : "";
  console.log(JSON.stringify({ type: "assistant", message: { content: [{ type: "tool_use", id, name: "Bash", input: { command } }] } }));
  console.log(JSON.stringify({ type: "user", message: { content: [{ type: "tool_result", tool_use_id: id, content, is_error: isError }] } }));
});
console.log(JSON.stringify({ type: "result", subtype: "success" }));
`;

let temp: string;
let projectDir: string;

beforeEach(() => {
  temp = realpathSync(mkdtempSync(join(tmpdir(), "sandbox-probe-test-")));
  projectDir = join(temp, "project");
  mkdirSync(join(projectDir, ".claude"), { recursive: true });
  writeSandboxBlock({ enabled: true, filesystem: { denyWrite: ["~"] } });
});

afterEach(() => {
  rmSync(temp, { recursive: true, force: true });
});

function writeSandboxBlock(sandbox: Record<string, unknown>): void {
  writeFileSync(
    join(projectDir, ".claude", "settings.json"),
    JSON.stringify({ sandbox, hooks: { PreToolUse: [] } }),
  );
}

function executable(name: string, source: string): string {
  const path = join(temp, name);
  writeFileSync(path, source);
  chmodSync(path, 0o755);
  return path;
}

function commandsFile(text: string): string {
  const path = join(temp, "commands.txt");
  writeFileSync(path, text);
  return path;
}

function launchArgs(): string[] {
  return JSON.parse(readFileSync(join(temp, "args.json"), "utf8")) as string[];
}

function argAfter(flag: string): string | undefined {
  const args = launchArgs();
  return args[args.indexOf(flag) + 1];
}

describe("SandboxProbe", () => {
  it("reports each listed command as ran, stopped with its first error line, or not run", async () => {
    const probe = SandboxProbe.init(executable("claude.mjs", fakeClaude));

    const report = await probe.run(
      projectDir,
      commandsFile("touch ./inside\n\ntouch ~/denied\n  ls skipped  \n"),
    );

    expect(report.outcomes.map(commandOutcomeText)).toEqual([
      "ran: touch ./inside",
      "stopped: touch ~/denied (touch ~/denied: Operation not permitted)",
      "not run: ls skipped",
    ]);
    expect(report.events).toContainEqual({
      type: "result",
      subtype: "success",
    });
  });

  it("launches with only the folder's sandbox block, its escape hatch shut, its sandboxed calls allowed and no command excluded", async () => {
    writeSandboxBlock({
      enabled: true,
      allowUnsandboxedCommands: true,
      autoAllowBashIfSandboxed: false,
      excludedCommands: ["gh"],
    });
    const probe = SandboxProbe.init(executable("claude.mjs", fakeClaude));

    await probe.run(projectDir, commandsFile("touch ./inside\n"));

    expect(JSON.parse(argAfter("--settings") ?? "")).toEqual({
      sandbox: {
        enabled: true,
        allowUnsandboxedCommands: false,
        autoAllowBashIfSandboxed: true,
      },
    });
    expect(argAfter("--setting-sources")).toBe("");
    expect(argAfter("--tools")).toBe("Bash");
    expect(argAfter("--permission-prompts")).toBe("none");
    expect(argAfter("--max-turns")).toBe("2");
  });

  it("keeps the folder's excluded commands, and lets them run unprompted, when asked to", async () => {
    writeSandboxBlock({
      enabled: true,
      allowUnsandboxedCommands: true,
      excludedCommands: ["ps *"],
    });
    const probe = SandboxProbe.init(executable("claude.mjs", fakeClaude));

    await probe.runKeepingExcluded(projectDir, commandsFile("ps -p 1\n"));

    expect(JSON.parse(argAfter("--settings") ?? "")).toEqual({
      sandbox: {
        enabled: true,
        allowUnsandboxedCommands: false,
        autoAllowBashIfSandboxed: true,
        excludedCommands: ["ps *"],
      },
      permissions: { allow: ["Bash"] },
    });
  });

  it("tells the session to run each command once, never retrying or disabling the sandbox", async () => {
    const probe = SandboxProbe.init(executable("claude.mjs", fakeClaude));

    await probe.run(projectDir, commandsFile("touch ./inside\n"));

    expect(argAfter("-p")).toMatch(
      /never retry a command.*disable the sandbox/,
    );
  });

  it("throws on an empty command list", async () => {
    const probe = SandboxProbe.init(executable("claude.mjs", fakeClaude));

    await expect(probe.run(projectDir, commandsFile("\n  \n"))).rejects.toThrow(
      "holds no commands",
    );
  });

  it("throws when the folder's settings have no sandbox block", async () => {
    writeFileSync(join(projectDir, ".claude", "settings.json"), "{}");
    const probe = SandboxProbe.init(executable("claude.mjs", fakeClaude));

    await expect(
      probe.run(projectDir, commandsFile("touch ./inside\n")),
    ).rejects.toThrow("has no sandbox block");
  });

  it("matches a command listed twice to the session's calls of it in order", async () => {
    const probe = SandboxProbe.init(executable("claude.mjs", fakeClaude));

    const report = await probe.run(
      projectDir,
      commandsFile("touch ./inside\ntouch ./inside\n"),
    );

    expect(report.outcomes.map((outcome) => outcome.status)).toEqual([
      "ran",
      "stopped",
    ]);
  });

  it("throws with the exit code and stderr when the session prints no events", async () => {
    const probe = SandboxProbe.init(
      executable(
        "claude.mjs",
        "#!/usr/bin/env node\nconsole.error('not logged in');\nprocess.exit(2);\n",
      ),
    );

    await expect(
      probe.run(projectDir, commandsFile("touch ./inside\n")),
    ).rejects.toThrow("exited with 2 and printed no events: not logged in");
  });
});
