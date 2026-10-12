import { spawn } from "node:child_process";
import {
  existsSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

export interface SessionReading {
  // $CLAUDE_PROJECT_DIR as a hook sees it; the project's hooks resolve their paths from it.
  projectDir: string | undefined;
  hookCwd: string;
  // The SessionStart hook's stdin JSON.
  input: Record<string, unknown>;
}

const prompt = "Reply with the word ok.";

// Adds its SessionStart hook through `--settings`, so no hook in the probed folder is edited and auto mode has nothing to block.
export class SessionProbe {
  private readonly claudePath: string;

  constructor(claudePath: string) {
    this.claudePath = claudePath;
  }

  static init(claudePath = "claude"): SessionProbe {
    return new SessionProbe(claudePath);
  }

  async run(cwd: string): Promise<SessionReading> {
    const folder = mkdtempSync(join(tmpdir(), "session-probe-"));
    try {
      const readingPath = join(folder, "reading.json");
      const settingsPath = writeSettings(folder, readingPath);
      await runSession(this.claudePath, cwd, settingsPath);
      if (!existsSync(readingPath)) {
        throw new Error(`The probe's SessionStart hook never ran in ${cwd}`);
      }
      return JSON.parse(readFileSync(readingPath, "utf8")) as SessionReading;
    } finally {
      rmSync(folder, { recursive: true, force: true });
    }
  }
}

function writeSettings(folder: string, readingPath: string): string {
  const hookPath = join(folder, "hook.mjs");
  writeFileSync(
    hookPath,
    [
      'import { readFileSync, writeFileSync } from "node:fs";',
      "const input = JSON.parse(readFileSync(0, 'utf8'));",
      "const reading = { projectDir: process.env.CLAUDE_PROJECT_DIR, hookCwd: process.cwd(), input };",
      "writeFileSync(process.argv[2], JSON.stringify(reading, null, 2));",
    ].join("\n"),
  );
  const command = `node ${JSON.stringify(hookPath)} ${JSON.stringify(readingPath)}`;
  const settings = {
    hooks: { SessionStart: [{ hooks: [{ type: "command", command }] }] },
  };
  const settingsPath = join(folder, "settings.json");
  writeFileSync(settingsPath, JSON.stringify(settings));
  return settingsPath;
}

// No tools and one turn, so the probe session can't act on the folder it reads.
async function runSession(
  claudePath: string,
  cwd: string,
  settingsPath: string,
): Promise<void> {
  const args = [
    "-p",
    prompt,
    "--settings",
    settingsPath,
    "--tools",
    "",
    "--max-turns",
    "1",
    "--model",
    "haiku",
    "--no-session-persistence",
  ];
  const child = spawn(claudePath, args, { cwd, stdio: "ignore" });
  const exitCode = await new Promise<number | null>((resolve, reject) => {
    child.on("error", reject);
    child.on("close", resolve);
  });
  if (exitCode !== 0) {
    throw new Error(`The probe session in ${cwd} exited with ${exitCode}`);
  }
}
