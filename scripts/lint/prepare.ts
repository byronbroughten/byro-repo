// The root's prepare script: points the root and each package clone at the root's .githooks, so every commit is checked.
import { join } from "node:path";

import { clonePathsOf } from "@byronbroughten/spec-runner/clonePaths";

import { hooksPathOf, repoRoot, setHooksPath } from "./lintCommands.ts";

try {
  Object.values(clonePathsOf(repoRoot)).forEach((clonePath) => {
    setHooksPath(join(repoRoot, clonePath), hooksPathOf(clonePath));
  });
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
}
