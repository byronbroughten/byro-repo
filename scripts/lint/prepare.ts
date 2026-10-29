// The root's prepare script: points the root and each package clone at the root's .githooks, so every commit is checked.
import { execFileSync } from "node:child_process";
import { join } from "node:path";

import { clonePathsOf } from "@byronbroughten/spec-runner/clonePaths";

import { hooksPathOf, repoRoot } from "./lintCommands.ts";

Object.values(clonePathsOf(repoRoot)).forEach((clonePath) => {
  execFileSync("git", ["config", "core.hooksPath", hooksPathOf(clonePath)], {
    cwd: join(repoRoot, clonePath),
  });
});
