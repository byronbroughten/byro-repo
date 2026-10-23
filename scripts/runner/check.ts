// `npm run check`: the type check, tests and lint at the same time, skipped on a check stamp for the same committed files.
// Usage: npm run check [-- --fresh].
import { join } from "node:path";

import { Checks } from "@byronbroughten/spec-runner/Checks";
import { commandLabelOf } from "@byronbroughten/spec-runner/failureText";
import type { Command } from "@byronbroughten/spec-runner/runKnobs";

import { runKnobs, stateFolder } from "./runnerConfig.ts";

const usage = "Usage: npm run check [-- --fresh]";

const commands: Command[] = [
  ["npm", "run", "tsc"],
  ["npm", "test"],
  ["npm", "run", "lint"],
];

const args = process.argv.slice(2);
if (args.some((arg) => arg !== "--fresh")) throw new Error(usage);

console.log(`Checking: ${commands.map(commandLabelOf).join("; ")}.`);
const result = await Checks.init({
  commands,
  root: join(import.meta.dirname, "../.."),
  clonePaths: runKnobs.clonePaths,
  stampFolder: join(stateFolder, "check-stamps"),
  nodeVersion: process.version,
}).run({ isFresh: args.includes("--fresh") });

if (result.kind === "skipped") {
  console.log(
    "Skipped on a check stamp: these committed files already passed.",
  );
} else if (result.kind === "passed") {
  const stampLine = result.isStamped
    ? "Stamped."
    : "Not stamped: a repo has uncommitted or untracked changes.";
  console.log(`check passed. ${stampLine}`);
} else {
  result.failures.forEach(({ command, output }) =>
    console.error(`\n--- ${commandLabelOf(command)} ---\n${output}`),
  );
  const labels = result.failures.map(({ command }) => commandLabelOf(command));
  console.error(`\ncheck failed: ${labels.join("; ")}`);
  process.exitCode = 1;
}
if (result.kind !== "skipped") {
  const timings = result.durations.map(
    ({ command, ms }) =>
      `${commandLabelOf(command)} ${(ms / 1000).toFixed(1)}s`,
  );
  console.log(`Took: ${timings.join("; ")}.`);
}
