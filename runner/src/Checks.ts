// Runs the checks for `npm run check` inside the check slot (CheckSlot.ts): every command at once, narrowed to the
// packages with no check stamp for their committed files, and skipped when every package has one.
// A package's stamp key hashes its committed files, those of every package it depends on, directly or not, the shared
// files, the root lockfile and the Node version; one file per key in the package's stamp folder, written only on a pass
// with those files clean and holding that pass's per-command durations.
// SpecRun.ts and WrapUp.ts run whatever commands their checks setting names and know nothing of stamps.
// scripts/runner/check.ts names the commands and packages and prints the result; failureText.ts labels a failure.
import type { SpawnOptions } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, isAbsolute, join, relative } from "node:path";

import { CheckSlot } from "./CheckSlot.ts";
import { git } from "./git.ts";
import type { LockWait } from "./PidLock.ts";
import { runCollecting } from "./runCollecting.ts";
import type { Command } from "./runKnobs.ts";

export interface CheckedPackage {
  name: string;
  // Relative to the root, as excludedPaths are; a folder of a repo or a whole clone.
  path: string;
  // Folders inside path that hold other packages, left out of this package's files.
  excludedPaths: string[];
  // The names of the packages it depends on.
  dependencies: string[];
}

export interface ChecksConfig {
  commands: Command[];
  // The checkout the commands run in; its package-lock.json is the root lockfile.
  root: string;
  packages: CheckedPackage[];
  // Files every package's checks read, relative to the root; a change to one puts every package back.
  sharedPaths: string[];
  // The environment that narrows the commands to the packages named.
  commandEnvOf: (packageNames: string[]) => Record<string, string>;
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

interface PackageReport {
  checked: string[];
  // Skipped on a stamp.
  skipped: string[];
}

export type CheckResult =
  | { kind: "skipped" }
  | (PackageReport & {
      kind: "passed";
      stamped: string[];
      durations: CommandDuration[];
    })
  | (PackageReport & {
      kind: "failed";
      failures: CommandFailure[];
      durations: CommandDuration[];
    });

interface CommandOutcome {
  duration: CommandDuration;
  failure?: CommandFailure;
}

// A set of committed files: a digest of their HEAD listing, and whether any has a change no stamp could describe.
interface FilesState {
  digest: string;
  isDirty: boolean;
}

interface FilesSpec {
  folder: string;
  includedPaths: string[];
  // Relative to folder.
  excludedPaths: string[];
}

interface PackageState {
  pkg: CheckedPackage;
  files: FilesState;
}

export class Checks {
  private readonly config: ChecksConfig;

  constructor(config: ChecksConfig) {
    this.config = config;
  }

  static init(config: ChecksConfig): Checks {
    return new Checks(config);
  }

  // The stamps are read only once the slot is taken, so a check that waited sees the stamps the one ahead of it wrote.
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
    const before = await this._stampPaths();
    const names = this.config.packages.map(({ name }) => name);
    const checked = names.filter(
      (name) => options.isFresh || !isStampedAt(before.get(name)),
    );
    if (checked.length === 0) return { kind: "skipped" };
    const skipped = names.filter((name) => !checked.includes(name));
    const outcomes = await this._outcomes(checked);
    const durations = outcomes.map(({ duration }) => duration);
    const failures = outcomes.flatMap(({ failure }) =>
      failure ? [failure] : [],
    );
    if (failures.length > 0) {
      return { kind: "failed", checked, skipped, failures, durations };
    }
    // Read again: a check, or the operator, may have changed the files while the commands ran.
    const after = await this._stampPaths();
    const stamps = checked.flatMap((name) => {
      const stampPath = before.get(name);
      if (stampPath === undefined || after.get(name) !== stampPath) return [];
      return [{ name, stampPath }];
    });
    stamps.forEach(({ stampPath }) =>
      writeStamp(stampPath, JSON.stringify(durations)),
    );
    const stamped = stamps.map(({ name }) => name);
    return { kind: "passed", checked, skipped, stamped, durations };
  }

  // Each package's stamp path; undefined while it or a package it depends on has a change no stamp could describe.
  private async _stampPaths(): Promise<Map<string, string | undefined>> {
    const { packages, sharedPaths, root, nodeVersion } = this.config;
    const [shared, stateByName] = await Promise.all([
      filesStateOf({
        folder: root,
        includedPaths: sharedPaths,
        excludedPaths: [],
      }),
      this._packageStates(),
    ]);
    const keyEnding = [
      `shared ${shared.digest}\n`,
      lockfileOf(root),
      `\n${nodeVersion}`,
    ];
    return new Map(
      packages.map(({ name }) => {
        const closure = dependencyClosureOf(name, stateByName);
        if (shared.isDirty || closure.some(({ files }) => files.isDirty)) {
          return [name, undefined];
        }
        const key = stampKeyOf(closure, keyEnding);
        return [name, join(this._stampFolder, name, key)];
      }),
    );
  }

  private async _packageStates(): Promise<Map<string, PackageState>> {
    const states = await Promise.all(
      this.config.packages.map(async (pkg) => ({
        pkg,
        files: await filesStateOf(filesSpecOf(this.config.root, pkg)),
      })),
    );
    return new Map(states.map((state) => [state.pkg.name, state]));
  }

  private get _stampFolder(): string {
    return join(this.config.stateFolder, "check-stamps");
  }

  private _outcomes(packageNames: string[]): Promise<CommandOutcome[]> {
    const env = { ...process.env, ...this.config.commandEnvOf(packageNames) };
    return Promise.all(
      this.config.commands.map((command) =>
        outcomeOf(command, { cwd: this.config.root, env }),
      ),
    );
  }
}

function isStampedAt(stampPath: string | undefined): boolean {
  return stampPath !== undefined && existsSync(stampPath);
}

function writeStamp(stampPath: string, contents: string): void {
  mkdirSync(dirname(stampPath), { recursive: true });
  writeFileSync(stampPath, contents);
}

// The package's own folder, less the folders of the other packages inside it.
function filesSpecOf(root: string, pkg: CheckedPackage): FilesSpec {
  const excludedPaths = pkg.excludedPaths
    .map((path) => relative(pkg.path, path))
    .filter(
      (path) => path !== "" && !path.startsWith("..") && !isAbsolute(path),
    );
  return {
    folder: join(root, pkg.path),
    includedPaths: ["."],
    excludedPaths,
  };
}

async function filesStateOf(spec: FilesSpec): Promise<FilesState> {
  if (spec.includedPaths.length === 0) return { digest: "", isDirty: false };
  const [listing, isDirty] = await Promise.all([
    committedListingOf(spec),
    hasChangesIn(spec),
  ]);
  return {
    digest: createHash("sha256").update(listing).digest("hex"),
    isDirty,
  };
}

// ls-tree takes no exclude pathspec, so the excluded folders are filtered out of its listing here.
async function committedListingOf({
  folder,
  includedPaths,
  excludedPaths,
}: FilesSpec): Promise<string> {
  const listing = await git(
    folder,
    "ls-tree",
    "-r",
    "-z",
    "HEAD",
    "--",
    ...includedPaths,
  );
  return listing
    .split("\0")
    .filter((entry) => {
      if (entry === "") return false;
      const path = entry.slice(entry.indexOf("\t") + 1);
      return !excludedPaths.some(
        (excluded) => path === excluded || path.startsWith(`${excluded}/`),
      );
    })
    .join("\n");
}

// No optional locks, as git.ts's isDirty, so a status read never holds index.lock against a commit running there.
async function hasChangesIn({
  folder,
  includedPaths,
  excludedPaths,
}: FilesSpec): Promise<boolean> {
  const status = await git(
    folder,
    "--no-optional-locks",
    "status",
    "--porcelain",
    "--",
    ...includedPaths,
    ...excludedPaths.map((path) => `:(exclude)${path}`),
  );
  return status !== "";
}

// The package and every package it depends on, directly or not, sorted by name so the key never depends on list order.
function dependencyClosureOf(
  name: string,
  stateByName: Map<string, PackageState>,
): PackageState[] {
  const reached = new Map<string, PackageState>();
  const pending = [name];
  for (let next = pending.pop(); next !== undefined; next = pending.pop()) {
    if (reached.has(next)) continue;
    const state = stateByName.get(next);
    if (state === undefined) {
      throw new Error(
        `A package depends on ${next}, which is no checked package.`,
      );
    }
    reached.set(next, state);
    pending.push(...state.pkg.dependencies);
  }
  return [...reached.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([, state]) => state);
}

function stampKeyOf(
  closure: PackageState[],
  keyEnding: (Buffer | string)[],
): string {
  const hash = createHash("sha256");
  closure.forEach(({ pkg, files }) =>
    hash.update(`${pkg.name} ${files.digest}\n`),
  );
  keyEnding.forEach((part) => hash.update(part));
  return hash.digest("hex");
}

// The lockfile is gitignored, so its bytes go into the key directly; a missing one hashes as a marker.
function lockfileOf(root: string): Buffer | string {
  const path = join(root, "package-lock.json");
  return existsSync(path) ? readFileSync(path) : "no lockfile";
}

async function outcomeOf(
  command: Command,
  options: SpawnOptions,
): Promise<CommandOutcome> {
  const [file, ...args] = command;
  const start = performance.now();
  const { isOk, output } = await runCollecting(file, args, options);
  const duration = { command, ms: Math.round(performance.now() - start) };
  if (isOk) return { duration };
  return { duration, failure: { command, output } };
}
