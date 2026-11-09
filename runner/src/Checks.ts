// Runs the checks for `npm run check` inside the check slot (CheckSlot.ts): every command at once, skipped on a check
// stamp for the same committed files.
// A stamp's key hashes each repo's committed tree, the root lockfile and the Node version; one file per key in the
// stamp folder, written only on a pass with every repo clean and holding that pass's per-command durations.
// SpecRun.ts and WrapUp.ts run whatever commands their checks setting names and know nothing of stamps.
// scripts/runner/check.ts names the commands and prints the result; the label a failure is listed under comes from
// failureText.ts.
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { CheckSlot } from "./CheckSlot.ts";
import { git, isDirty } from "./git.ts";
import type { LockWait } from "./PidLock.ts";
import { runCollecting } from "./runCollecting.ts";
import type { Command } from "./runKnobs.ts";

export interface ChecksConfig {
  commands: Command[];
  // The checkout the commands run in; its package-lock.json is the root lockfile.
  root: string;
  // Repo name to its clone's path relative to root; the root repo's is ".".
  clonePaths: Record<string, string>;
  // The primary's state folder, which holds the check stamps and the check slot.
  stateFolder: string;
  nodeVersion: string;
  slot: LockWait;
}

export interface CheckOptions {
  isFresh?: boolean;
}

export interface CommandFailure {
  command: Command;
  output: string;
}

export interface CommandDuration {
  command: Command;
  ms: number;
}

export type CheckResult =
  | { kind: "skipped" }
  | { kind: "passed"; isStamped: boolean; durations: CommandDuration[] }
  | {
      kind: "failed";
      failures: CommandFailure[];
      durations: CommandDuration[];
    };

interface CommandOutcome {
  duration: CommandDuration;
  failure?: CommandFailure;
}

export class Checks {
  private readonly config: ChecksConfig;

  constructor(config: ChecksConfig) {
    this.config = config;
  }

  static init(config: ChecksConfig): Checks {
    return new Checks(config);
  }

  // The stamp is read only once the slot is taken, so a check that waited sees the stamp the one ahead of it wrote.
  async run(options: CheckOptions = {}): Promise<CheckResult> {
    const slot = await CheckSlot.acquire(
      this.config.stateFolder,
      this.config.slot,
    );
    try {
      return await this._runInSlot(options);
    } finally {
      slot.release();
    }
  }

  private async _runInSlot(options: CheckOptions): Promise<CheckResult> {
    const before = await this._stampPath();
    if (before !== undefined && !options.isFresh && existsSync(before)) {
      return { kind: "skipped" };
    }
    const outcomes = await this._outcomes();
    const durations = outcomes.map(({ duration }) => duration);
    const failures = outcomes.flatMap(({ failure }) =>
      failure ? [failure] : [],
    );
    if (failures.length > 0) return { kind: "failed", failures, durations };
    // Read again: a check, or the operator, may have changed the files while the commands ran.
    const after = await this._stampPath();
    if (before === undefined || after !== before) {
      return { kind: "passed", isStamped: false, durations };
    }
    mkdirSync(this._stampFolder, { recursive: true });
    writeFileSync(before, JSON.stringify(durations));
    return { kind: "passed", isStamped: true, durations };
  }

  // Undefined while any repo has a change no stamp could describe.
  private async _stampPath(): Promise<string | undefined> {
    if (await this._hasDirtyRepo()) return undefined;
    return join(this._stampFolder, await this._stampKey());
  }

  private get _stampFolder(): string {
    return join(this.config.stateFolder, "check-stamps");
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

  private _outcomes(): Promise<CommandOutcome[]> {
    return Promise.all(
      this.config.commands.map((command) =>
        outcomeOf(command, this.config.root),
      ),
    );
  }
}

// The lockfile is gitignored, so its bytes go into the key directly; a missing one hashes as a marker.
function lockfileOf(root: string): Buffer | string {
  const path = join(root, "package-lock.json");
  return existsSync(path) ? readFileSync(path) : "no lockfile";
}

async function outcomeOf(
  command: Command,
  cwd: string,
): Promise<CommandOutcome> {
  const [file, ...args] = command;
  const start = performance.now();
  const { isOk, output } = await runCollecting(file, args, { cwd });
  const duration = { command, ms: Math.round(performance.now() - start) };
  if (isOk) return { duration };
  return { duration, failure: { command, output } };
}
