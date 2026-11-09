import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { delimiter, dirname } from "node:path";
import { fileURLToPath } from "node:url";

import { defineConfig, type TestProjectConfiguration } from "vitest/config";

import {
  checkPackagesOf,
  selectedPackagesOf,
} from "./scripts/runner/checkPackages.ts";

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
async function frameworkProjects(): Promise<TestProjectConfiguration[]> {
  const frameworkConfig = new URL(
    "packages/framework/vitest.config.ts",
    import.meta.url,
  );
  if (!existsSync(frameworkConfig)) return [];
  // A URL, not a literal path: vite runs this file from a temp copy, and tsc resolves literals.
  const framework = (await import(frameworkConfig.href)) as {
    frameworkProjects: TestProjectConfiguration[];
  };
  return framework.frameworkProjects;
}

function utilsProjects(): TestProjectConfiguration[] {
  const utilsConfig = "packages/utils/vitest.config.ts";
  return existsSync(new URL(utilsConfig, import.meta.url)) ? [utilsConfig] : [];
}

function toolingProject(
  name: string,
  include: string[],
): TestProjectConfiguration {
  return {
    extends: true,
    // The runner words human-facing times in the machine's zone, so its tests pin one.
    test: { name, env: { TZ: "America/Chicago" }, include },
  };
}

async function projectsByPackage(): Promise<
  Record<string, TestProjectConfiguration[]>
> {
  return {
    root: [
      toolingProject("root", [
        "*.test.ts",
        ".claude/hooks/**/*.test.ts",
        ".claude/skills/**/*.test.ts",
        "scripts/**/*.test.ts",
      ]),
    ],
    config: [toolingProject("config", ["config/**/*.test.ts"])],
    runner: [toolingProject("runner", ["runner/**/*.test.ts"])],
    utils: utilsProjects(),
    framework: await frameworkProjects(),
    "real-estate": [
      {
        extends: true,
        test: {
          name: "real-estate",
          include: ["packages/real-estate/src/**/*.test.ts"],
          setupFiles: ["packages/real-estate/src/installAppConfigs.ts"],
        },
      },
    ],
  };
}

// CHECK_PACKAGES narrows the run to its packages' projects; a package with no tests, as personal, adds none.
async function selectedProjects(): Promise<TestProjectConfiguration[]> {
  const byPackage = await projectsByPackage();
  const packages = checkPackagesOf(
    fileURLToPath(new URL(".", import.meta.url)),
  );
  return selectedPackagesOf(packages, process.env.CHECK_PACKAGES).flatMap(
    ({ name }) => byPackage[name] ?? [],
  );
}

const projects = await selectedProjects();

// The framework's and utils' own projects join the root's, so one vitest run covers every package.
export default defineConfig({
  // Tests run in Vite's server environment, so the source condition goes on ssr.
  ssr: { resolve: { conditions: ["source"] } },
  test: {
    environment: "node",
    env: { PATH: pathWithDirectGitFirst() },
    restoreMocks: true,
    unstubGlobals: true,
    // With no project vitest would run the root config itself over every test file, so an empty selection gets one that matches nothing.
    projects:
      projects.length > 0
        ? projects
        : [{ test: { name: "none", include: [] } }],
    passWithNoTests: projects.length === 0,
    coverage: {
      provider: "v8",
      reporter: ["text", "html"],
      include: ["packages/real-estate/src/**/*.ts"],
      exclude: ["packages/real-estate/src/**/*.test.ts"],
    },
  },
});
