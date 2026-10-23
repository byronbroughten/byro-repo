import { execFileSync } from "node:child_process";
import { delimiter, dirname } from "node:path";

import { defineConfig } from "vitest/config";

import { frameworkProjects } from "./packages/framework/vitest.config.ts";

// macOS's /usr/bin/git is an xcrun shim that doubles each git call's cost, and the runner tests make thousands.
function directGitPath(): string | undefined {
  if (process.platform !== "darwin") return undefined;
  try {
    const git = execFileSync("xcrun", ["--find", "git"], { encoding: "utf8" });
    return [dirname(git.trim()), process.env.PATH].join(delimiter);
  } catch {
    return undefined;
  }
}

const path = directGitPath();

// The framework's and utils' own projects join the root's, so one vitest run covers every package.
export default defineConfig({
  // Tests run in Vite's server environment, so the source condition goes on ssr.
  ssr: { resolve: { conditions: ["source"] } },
  test: {
    environment: "node",
    ...(path && { env: { PATH: path } }),
    restoreMocks: true,
    unstubGlobals: true,
    projects: [
      ...frameworkProjects,
      "packages/utils/vitest.config.ts",
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
