// Run by .githooks/pre-commit in the root or a package clone: checks the staged files' formatting and lint, however they were edited.
import { execFileSync } from "node:child_process";
import { lstatSync } from "node:fs";
import { join, relative } from "node:path";

import {
  type Command,
  eslintFixOf,
  eslintOf,
  failedCommandsOf,
  isCode,
  prettierCheckOf,
  prettierWriteOf,
  repoRoot,
  rootPathsOf,
} from "./lintCommands.ts";

// Git runs a hook at the top of the committing repo's worktree.
const cloneRoot = process.cwd();
const staged = rootPathsOf(
  cloneRoot,
  execFileSync(
    "git",
    ["diff", "--cached", "--name-only", "--diff-filter=ACMR", "-z"],
    { cwd: cloneRoot, encoding: "utf8" },
  )
    .split("\0")
    .filter((path) => path !== ""),
)
  // Prettier refuses a symlink, such as a runner skill's link in `.claude/skills/`.
  .filter((path) => !lstatSync(join(repoRoot, path)).isSymbolicLink());
// Each check beside the command that fixes what it flags.
const checks: [Command, Command][] = [];
if (staged.length > 0) {
  checks.push([prettierCheckOf(staged), prettierWriteOf(staged)]);
}
const code = staged.filter(isCode);
if (code.length > 0) checks.push([eslintOf(code), eslintFixOf(code)]);

const failed = failedCommandsOf(checks.map(([check]) => check));
const fixes = checks
  .filter(([check]) => failed.includes(check))
  .map(([, fix]) => rootRelativeLabelOf(fix));
if (fixes.length > 0) {
  console.error(
    [
      "\npre-commit: the staged files failed. From the byro-repo root, run:",
      ...fixes.map((fix) => `  ${fix}`),
      "then stage the fix and commit again.",
    ].join("\n"),
  );
  process.exitCode = 1;
}

// The staged paths are root-relative, so the whole line reads as run from the root.
function rootRelativeLabelOf(command: Command): string {
  return command
    .map((part) =>
      part.startsWith(`${repoRoot}/`) ? relative(repoRoot, part) : part,
    )
    .join(" ");
}
