import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { delimiter, dirname } from "node:path";

import { defineConfig, type TestProjectConfiguration } from "vitest/config";

// macOS's /usr/bin/git is an xcrun shim that doubles each git call's cost, and the runner tests make thousands.
function pathWithDirectGitFirst(): string {
  const path = process.env.PATH ?? "";
  if (process.platform !== "darwin") return path;
  try {
    const git = execFileSync("xcrun", ["--find", "git"], { encoding: "utf8" });
    return [dirname(git.trim()), path].join(delimiter);
  } catch {
    return path;
  }
}

// packages/* are separate clones, so the root's own CI checks out none of them.
async function packageProjects(): Promise<TestProjectConfiguration[]> {
  const frameworkConfig = new URL(
    "packages/framework/vitest.config.ts",
    import.meta.url,
  );
  const utilsConfig = "packages/utils/vitest.config.ts";
  const projects: TestProjectConfiguration[] = [];
  if (existsSync(frameworkConfig)) {
    // A URL, not a literal path: vite runs this file from a temp copy, and tsc resolves literals.
    const framework = (await import(frameworkConfig.href)) as {
      frameworkProjects: TestProjectConfiguration[];
    };
    projects.push(...framework.frameworkProjects);
  }
  if (existsSync(new URL(utilsConfig, import.meta.url))) {
    projects.push(utilsConfig);
  }
  return projects;
}

// The framework's and utils' own projects join the root's, so one vitest run covers every package.
export default defineConfig({
  // Tests run in Vite's server environment, so the source condition goes on ssr.
  ssr: { resolve: { conditions: ["source"] } },
  test: {
    environment: "node",
    env: { PATH: pathWithDirectGitFirst() },
    restoreMocks: true,
    unstubGlobals: true,
    projects: [
      ...(await packageProjects()),
      {
        extends: true,
        test: {
          name: "real-estate",
          include: ["packages/real-estate/src/**/*.test.ts"],
          setupFiles: ["packages/real-estate/src/installAppConfigs.ts"],
        },
      },
      {
        extends: true,
        test: {
          name: "tooling",
          include: [
            "*.test.ts",
            "config/**/*.test.ts",
            "runner/**/*.test.ts",
            ".claude/hooks/**/*.test.ts",
            ".claude/skills/**/*.test.ts",
            "scripts/**/*.test.ts",
          ],
        },
      },
    ],
    coverage: {
      provider: "v8",
      reporter: ["text", "html"],
      include: ["packages/real-estate/src/**/*.ts"],
      exclude: ["packages/real-estate/src/**/*.test.ts"],
    },
  },
});
