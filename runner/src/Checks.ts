// Runs the checks for `npm run check`: every command at once, skipped on a check stamp for the same committed files.
// A stamp's key hashes each repo's committed tree, the root lockfile and the Node version; one file per key in the
// stamp folder, written only on a pass with every repo clean. SpecRun.ts and WrapUp.ts run whatever commands their
// checks setting names and know nothing of stamps. scripts/runner/check.ts names the commands and prints the result;
// the label a failure is listed under comes from failureText.ts.
import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { git, isDirty } from "./git.ts";
import type { Command } from "./runKnobs.ts";

export interface ChecksConfig {
  commands: Command[];
  // The checkout the commands run in; its package-lock.json is the root lockfile.
  root: string;
  // Repo name to its clone's path relative to root; the root repo's is ".".
  clonePaths: Record<string, string>;
  stampFolder: string;
  nodeVersion: string;
}

export interface CheckOptions {
  fresh?: boolean;
}

export interface CommandFailure {
  command: Command;
  output: string;
}

export type CheckResult =
  | { kind: "skipped" }
  | { kind: "passed"; isStamped: boolean }
  | { kind: "failed"; failures: CommandFailure[] };

export class Checks {
  private readonly config: ChecksConfig;

  constructor(config: ChecksConfig) {
    this.config = config;
  }

  static init(config: ChecksConfig): Checks {
    return new Checks(config);
  }

  async run(options: CheckOptions = {}): Promise<CheckResult> {
    const before = await this._stampPath();
    if (before !== undefined && !options.fresh && existsSync(before)) {
      return { kind: "skipped" };
    }
    const failures = await this._failures();
    if (failures.length > 0) return { kind: "failed", failures };
    // Read again: a check, or the operator, may have changed the files while the commands ran.
    const after = await this._stampPath();
    if (before === undefined || after !== before) {
      return { kind: "passed", isStamped: false };
    }
    mkdirSync(this.config.stampFolder, { recursive: true });
    writeFileSync(before, "");
    return { kind: "passed", isStamped: true };
  }

  // Undefined while any repo has a change no stamp could describe.
  private async _stampPath(): Promise<string | undefined> {
    if (await this._hasDirtyRepo()) return undefined;
    return join(this.config.stampFolder, await this._stampKey());
  }

  private async _hasDirtyRepo(): Promise<boolean> {
    const dirty = await Promise.all(this._repoPaths.map(isDirty));
    return dirty.includes(true);
  }

  private async _stampKey(): Promise<string> {
    const trees = await Promise.all(
      this._repoPaths.map((path) => git(path, "rev-parse", "HEAD^{tree}")),
    );
    const hash = createHash("sha256");
    trees.forEach((tree) => hash.update(`${tree}\n`));
    hash.update(lockfileOf(this.config.root));
    hash.update(`\n${this.config.nodeVersion}`);
    return hash.digest("hex");
  }

  // Sorted by repo name, so the key never depends on the config's key order.
  private get _repoPaths(): string[] {
    return Object.entries(this.config.clonePaths)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([, clonePath]) => join(this.config.root, clonePath));
  }

  private async _failures(): Promise<CommandFailure[]> {
    const outcomes = await Promise.all(
      this.config.commands.map((command) =>
        failureOf(command, this.config.root),
      ),
    );
    return outcomes.flatMap((failure) => (failure ? [failure] : []));
  }
}

// The lockfile is gitignored, so its bytes go into the key directly; a missing one hashes as a marker.
function lockfileOf(root: string): Buffer | string {
  const path = join(root, "package-lock.json");
  return existsSync(path) ? readFileSync(path) : "no lockfile";
}

function failureOf(
  command: Command,
  cwd: string,
): Promise<CommandFailure | undefined> {
  const [file, ...args] = command;
  return new Promise((resolve) => {
    const child = spawn(file, args, { cwd });
    let output = "";
    child.stdout.on("data", (chunk) => (output += chunk));
    child.stderr.on("data", (chunk) => (output += chunk));
    child.on("error", (error) => resolve({ command, output: error.message }));
    child.on("close", (code) =>
      resolve(code === 0 ? undefined : { command, output: output.trim() }),
    );
  });
}
