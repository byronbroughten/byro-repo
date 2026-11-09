// `npm run lint`: runs every step even when an earlier one fails, then lists the failures together.
// CHECK_PACKAGES narrows it to the files of the packages it names (scripts/runner/checkPackages.ts).
import {
  checkPackagesOf,
  packageNamesOf,
  selectedPackagesOf,
} from "../runner/checkPackages.ts";
import {
  type Command,
  commandLabelOf,
  eslintOf,
  failedCommandsOf,
  packageLintCommandsOf,
  repoRoot,
} from "./lintCommands.ts";

const failed = failedCommandsOf(commandsOf(process.env.CHECK_PACKAGES));
if (failed.length > 0) {
  console.error(`\nlint failed: ${failed.map(commandLabelOf).join("; ")}`);
  process.exitCode = 1;
}

function commandsOf(packageNamesText: string | undefined): Command[] {
  if (packageNamesOf(packageNamesText).length === 0) return everyLintCommand();
  const packages = checkPackagesOf(repoRoot);
  return packageLintCommandsOf(
    selectedPackagesOf(packages, packageNamesText),
    packages,
  );
}

function everyLintCommand(): Command[] {
  return [
    eslintOf(["."]),
    ["npm", "run", "-s", "lint:docs"],
    ["npm", "run", "-s", "lint:docs", "--workspaces", "--if-present"],
    ["npm", "run", "-s", "format:check"],
  ];
}
