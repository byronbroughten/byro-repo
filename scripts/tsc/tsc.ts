// `npm run tsc`: every type-check program at once, the root's and each `&&` part of a workspace's own tsc script.
// CHECK_PACKAGES narrows it to the programs of the packages it names (scripts/runner/checkPackages.ts).
// Prints each program's output under its label, then fails when any program does.
import { delimiter, join, relative } from "node:path";

import {
  type CollectedRun,
  runCollecting,
} from "@byronbroughten/spec-runner/runCollecting";

import {
  type CheckPackage,
  checkPackagesOf,
  isRootPackage,
  selectedPackagesOf,
} from "../runner/checkPackages.ts";

interface Program {
  cwd: string;
  command: string;
}

interface Outcome extends CollectedRun {
  label: string;
}

const root = join(import.meta.dirname, "../..");

const programs = selectedPackagesOf(
  checkPackagesOf(root),
  process.env.CHECK_PACKAGES,
).flatMap(programsOf);

const outcomes = await Promise.all(programs.map(outcomeOf));
outcomes
  .filter(({ output }) => output !== "")
  .forEach(({ label, output }) => console.log(`--- ${label} ---\n${output}`));
const failed = outcomes.filter(({ isOk }) => !isOk);
if (failed.length > 0) {
  console.error(`tsc failed: ${failed.map(({ label }) => label).join("; ")}`);
  process.exitCode = 1;
}

// The root's own tsc script is this file, so its program is named here.
function programsOf(pkg: CheckPackage): Program[] {
  const cwd = join(root, pkg.path);
  if (isRootPackage(pkg)) return [{ cwd, command: "tsc -p ." }];
  return (pkg.scripts.tsc ?? "")
    .split("&&")
    .map((command) => command.trim())
    .filter((command) => command !== "")
    .map((command) => ({ cwd, command }));
}

async function outcomeOf({ cwd, command }: Program): Promise<Outcome> {
  const label = `${relative(root, cwd) || "."}: ${command}`;
  // The workspace's own bin folder first, as `npm run` would put it.
  const pathWithWorkspaceBin = [
    join(cwd, "node_modules/.bin"),
    process.env.PATH,
  ].join(delimiter);
  const run = await runCollecting("sh", ["-c", command], {
    cwd,
    env: { ...process.env, PATH: pathWithWorkspaceBin },
  });
  return { label, ...run };
}
