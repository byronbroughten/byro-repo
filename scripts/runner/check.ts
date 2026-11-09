// `npm run check`: the type check, tests and lint at the same time, narrowed to the packages with no check stamp for
// their committed files, and skipped when every package has one.
// It waits for the check slot first, one check per primary root at a time.
// The packages come from scripts/runner/checkPackages.ts, and CHECK_PACKAGES narrows each command to them.
// Usage: npm run check [-- --fresh].
import { join } from "node:path";
import { setTimeout as sleep } from "node:timers/promises";

import {
  Checks,
  type CommandDuration,
  type PackageReport,
  type PassedCheck,
} from "@byronbroughten/spec-runner/Checks";
import { commandLabelOf } from "@byronbroughten/spec-runner/failureText";
import type { Command } from "@byronbroughten/spec-runner/runKnobs";

import { checkPackagesOf, sharedRootFiles } from "./checkPackages.ts";
import { stateFolder } from "./runnerConfig.ts";

const usage = "Usage: npm run check [-- --fresh]";

const commands: Command[] = [
  ["npm", "run", "tsc"],
  ["npm", "test"],
  ["npm", "run", "lint"],
];

const args = process.argv.slice(2);
if (args.some((arg) => arg !== "--fresh")) throw new Error(usage);

const root = join(import.meta.dirname, "../..");
const packages = checkPackagesOf(root);

console.log(`Checking: ${commands.map(commandLabelOf).join("; ")}.`);
const result = await Checks.init({
  commands,
  root,
  packages,
  sharedPaths: sharedRootFiles,
  commandEnvOf,
  stateFolder,
  nodeVersion: process.version,
  slot: { pollMs: 1000, sleep, onHeld: printWaiting },
}).run({ isFresh: args.includes("--fresh") });

if (result.kind === "skipped") {
  console.log(
    "Skipped on a check stamp: these committed files already passed.",
  );
} else if (result.kind === "passed") {
  console.log(packagesLine(result));
  console.log(`check passed. ${stampLine(result)}`);
  console.log(timingLine(result.durations));
} else {
  console.log(packagesLine(result));
  result.failures.forEach(({ command, output }) =>
    console.error(`\n--- ${commandLabelOf(command)} ---\n${output}`),
  );
  const labels = result.failures.map(({ command }) => commandLabelOf(command));
  console.error(`\ncheck failed: ${labels.join("; ")}`);
  process.exitCode = 1;
  console.log(timingLine(result.durations));
}

// A blank CHECK_PACKAGES runs each command whole, so checking every package runs exactly what an unnarrowed check did.
function commandEnvOf(packageNames: string[]): Record<string, string> {
  if (packageNames.length === packages.length) return { CHECK_PACKAGES: "" };
  return { CHECK_PACKAGES: packageNames.join(",") };
}

function packagesLine({ checked, skipped }: PackageReport): string {
  const skippedText = skipped.length > 0 ? skipped.join(", ") : "none";
  return `Packages checked: ${checked.join(", ")}. Skipped on a check stamp: ${skippedText}.`;
}

function stampLine({ checked, stamped }: PassedCheck): string {
  const unstamped = checked.filter((name) => !stamped.includes(name));
  if (unstamped.length === 0) return "Stamped.";
  return `Not stamped: ${unstamped.join(", ")}; its files, or those of a package it depends on, have uncommitted or untracked changes, or changed while the checks ran.`;
}

function printWaiting(pid: number | undefined): void {
  const holder =
    pid === undefined ? "another check" : `the check in pid ${pid}`;
  console.log(
    `Waiting for the check slot, held by ${holder}; no time limit, so this is not a hang.`,
  );
}

function timingLine(durations: CommandDuration[]): string {
  const timings = durations.map(
    ({ command, ms }) =>
      `${commandLabelOf(command)} ${(ms / 1000).toFixed(1)}s`,
  );
  return `Took: ${timings.join("; ")}.`;
}
