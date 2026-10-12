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

import { SessionProbe } from "./SessionProbe.ts";

// Stands in for claude: runs each SessionStart hook from --settings the way Claude Code does, with $CLAUDE_PROJECT_DIR set.
const fakeClaude = `#!/usr/bin/env node
import { execSync } from "node:child_process";
import { readFileSync } from "node:fs";
const args = process.argv.slice(2);
const settings = JSON.parse(readFileSync(args[args.indexOf("--settings") + 1], "utf8"));
const input = JSON.stringify({ hook_event_name: "SessionStart", cwd: process.cwd() });
settings.hooks.SessionStart.forEach((entry) =>
  entry.hooks.forEach((hook) =>
    execSync(hook.command, { input, env: { ...process.env, CLAUDE_PROJECT_DIR: process.cwd() } }),
  ),
);
`;

let temp: string;
let projectDir: string;

beforeEach(() => {
  temp = realpathSync(mkdtempSync(join(tmpdir(), "session-probe-test-")));
  projectDir = join(temp, "project");
  mkdirSync(projectDir);
});

afterEach(() => {
  rmSync(temp, { recursive: true, force: true });
});

function executable(name: string, source: string): string {
  const path = join(temp, name);
  writeFileSync(path, source);
  chmodSync(path, 0o755);
  return path;
}

function probeFolders(): string[] {
  return readdirSync(tmpdir()).filter(
    (name) =>
      name.startsWith("session-probe-") &&
      !name.startsWith("session-probe-test-"),
  );
}

describe("SessionProbe", () => {
  it("reports the project dir, cwd and input the session's hook saw", async () => {
    const probe = SessionProbe.init(executable("claude.mjs", fakeClaude));

    const reading = await probe.run(projectDir);

    expect(reading.projectDir).toBe(projectDir);
    expect(reading.hookCwd).toBe(projectDir);
    expect(reading.input).toMatchObject({ hook_event_name: "SessionStart" });
  });

  it("leaves no settings or hook file behind", async () => {
    const before = probeFolders();
    const probe = SessionProbe.init(executable("claude.mjs", fakeClaude));

    await probe.run(projectDir);

    expect(probeFolders()).toEqual(before);
    expect(existsSync(join(projectDir, ".claude"))).toBe(false);
  });

  it("throws when the session never ran the hook", async () => {
    const probe = SessionProbe.init(
      executable("claude.mjs", "#!/usr/bin/env node\n"),
    );

    await expect(probe.run(projectDir)).rejects.toThrow(
      "The probe's SessionStart hook never ran",
    );
  });

  it("throws when the session exits with an error", async () => {
    const probe = SessionProbe.init(
      executable("claude.mjs", "#!/usr/bin/env node\nprocess.exit(2);\n"),
    );

    await expect(probe.run(projectDir)).rejects.toThrow("exited with 2");
  });
});
