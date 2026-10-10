import { globSync } from "node:fs";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import vitestConfig from "./vitest.config.ts";

const repoRoot = fileURLToPath(new URL(".", import.meta.url));

describe("the root vitest projects", () => {
  // A test no project includes never runs, and npm test still passes.
  it("include every test file outside a package with its own vitest config", () => {
    const included = new Set(globSync(rootIncludes(), { cwd: repoRoot }));
    const uncovered = testFiles().filter((path) => !included.has(path));
    expect(uncovered).toEqual([]);
  });
});

function rootIncludes(): string[] {
  return (vitestConfig.test?.projects ?? []).flatMap((project) => {
    if (typeof project === "object" && "test" in project) {
      return project.test?.include ?? [];
    }
    return [];
  });
}

function testFiles(): string[] {
  const selfRunPackages = globSync("packages/*/vitest.config.ts", {
    cwd: repoRoot,
  }).map(dirname);
  return globSync("**/*.test.ts", {
    cwd: repoRoot,
    exclude: [
      "**/node_modules/**",
      ".git/**",
      ".claude/worktrees/**",
      ...selfRunPackages.map((path) => `${path}/**`),
    ],
  });
}
