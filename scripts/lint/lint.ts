// `npm run lint`: runs every step even when an earlier one fails, then lists the failures together.
import { commandLabelOf, eslintOf, failedCommandsOf } from "./lintCommands.ts";

const failed = failedCommandsOf([
  eslintOf(["."]),
  ["npm", "run", "-s", "lint:docs"],
  ["npm", "run", "-s", "lint:docs", "--workspaces", "--if-present"],
  ["npm", "run", "-s", "format:check"],
]);
if (failed.length > 0) {
  console.error(`\nlint failed: ${failed.map(commandLabelOf).join("; ")}`);
  process.exitCode = 1;
}
