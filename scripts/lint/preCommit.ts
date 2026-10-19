// Run by .githooks/pre-commit: checks the staged files' formatting and lint, however they were edited.
import { execFileSync } from "node:child_process";
import { lstatSync } from "node:fs";
import { basename, join } from "node:path";

import {
  type Command,
  eslintOf,
  failedCommandsOf,
  isCode,
  prettierCheckOf,
  repoRoot,
} from "./lintCommands.ts";

const staged = execFileSync(
  "git",
  ["diff", "--cached", "--name-only", "--diff-filter=ACMR", "-z"],
  { cwd: repoRoot, encoding: "utf8" },
)
  .split("\0")
  .filter((path) => path !== "")
  // Prettier refuses a symlink, such as a runner skill's link in `.claude/skills/`.
  .filter((path) => !lstatSync(join(repoRoot, path)).isSymbolicLink());
const commands: Command[] = [];
if (staged.length > 0) commands.push(prettierCheckOf(staged));
const code = staged.filter(isCode);
if (code.length > 0) commands.push(eslintOf(code));

const failed = failedCommandsOf(commands);
if (failed.length > 0) {
  console.error(
    `\npre-commit: ${failed.map(([file]) => basename(file)).join(" and ")} failed on the staged files. Fix them (npx prettier --write, npx eslint --fix), stage the fix and commit again.`,
  );
  process.exitCode = 1;
}
