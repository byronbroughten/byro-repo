// The root's prepare script: points the root and each package clone at the root's .githooks, so every commit is checked.
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { hooksPathOf, repoRoot } from "./lintCommands.ts";

const { clonePaths } = JSON.parse(
  readFileSync(join(repoRoot, "scripts/runner/runner.config.json"), "utf8"),
) as { clonePaths: Record<string, string> };

for (const clonePath of Object.values(clonePaths)) {
  const clone = join(repoRoot, clonePath);
  // A clone that isn't checked out here, such as a private one, has nothing to point.
  if (!existsSync(join(clone, ".git"))) continue;
  execFileSync("git", ["config", "core.hooksPath", hooksPathOf(clonePath)], {
    cwd: clone,
  });
}
