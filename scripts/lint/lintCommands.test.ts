import { join } from "node:path";

import { describe, expect, it } from "vitest";

import type { CheckPackage } from "../runner/checkPackages.ts";
import {
  type Command,
  commandLabelOf,
  failedCommandsOf,
  packageLintCommandsOf,
  repoRoot,
  rootPathsOf,
} from "./lintCommands.ts";

const passes: Command = ["node", "-e", "process.exit(0)"];
const fails: Command = ["node", "-e", "process.exit(1)"];
const failsToo: Command = ["node", "-e", "process.exit(2)"];

describe("failedCommandsOf", () => {
  it("runs every command after a failure and returns each one that failed", () => {
    expect(failedCommandsOf([fails, passes, failsToo])).toEqual([
      fails,
      failsToo,
    ]);
  });

  it("returns none when every command passes", () => {
    expect(failedCommandsOf([passes, passes])).toEqual([]);
  });
});

describe("packageLintCommandsOf", () => {
  const root = {
    ...checkPackage("root", ".", { "lint:docs": "lint-docs" }),
    excludedPaths: ["runner", "packages/framework", "packages/personal"],
  };
  const runner = checkPackage("runner", "runner", {});
  const framework = checkPackage("framework", "packages/framework", {
    "lint:docs": "lint-docs --published .",
  });
  const personal = checkPackage("personal", "packages/personal", {
    "lint:docs": "lint-docs --published .",
  });
  const packages = [root, runner, framework, personal];

  it("lints only personal's files and docs when only personal is named", () => {
    expect(labelsOf([personal], packages)).toEqual([
      "eslint --flag v10_config_lookup_from_file --no-warn-ignored --no-error-on-unmatched-pattern packages/personal",
      "npm run -s lint:docs -w packages/personal",
      `prettier --check --ignore-unknown --ignore-path ${join(repoRoot, ".prettierignore")} --ignore-path packages/personal/.gitignore packages/personal`,
    ]);
  });

  it("lints the root's files without the packages left unnamed", () => {
    expect(labelsOf([root, framework], packages)).toEqual([
      "eslint --flag v10_config_lookup_from_file --no-warn-ignored --no-error-on-unmatched-pattern . --ignore-pattern runner/ --ignore-pattern packages/personal/",
      "npm run -s lint:docs",
      "npm run -s lint:docs -w packages/framework",
      "prettier --check --ignore-unknown . !runner/** !packages/framework/** !packages/personal/**",
      `prettier --check --ignore-unknown --ignore-path ${join(repoRoot, ".prettierignore")} --ignore-path packages/framework/.gitignore packages/framework`,
    ]);
  });

  it("runs the root's lint-docs for a named package with none of its own", () => {
    expect(labelsOf([runner], packages)).toEqual([
      "eslint --flag v10_config_lookup_from_file --no-warn-ignored --no-error-on-unmatched-pattern runner",
      "npm run -s lint:docs",
      `prettier --check --ignore-unknown --ignore-path ${join(repoRoot, ".prettierignore")} --ignore-path runner/.gitignore runner`,
    ]);
  });

  it("runs the root's lint-docs once when the root and a package it covers are named", () => {
    expect(
      labelsOf([root, runner], packages).filter((label) =>
        label.startsWith("npm run -s lint:docs"),
      ),
    ).toEqual(["npm run -s lint:docs"]);
  });
});

describe("rootPathsOf", () => {
  it("prefixes a clone's staged paths with the clone's path from the root", () => {
    expect(
      rootPathsOf(join(repoRoot, "packages/framework"), [
        "src/Sheet.ts",
        "README.md",
      ]),
    ).toEqual([
      "packages/framework/src/Sheet.ts",
      "packages/framework/README.md",
    ]);
  });

  it("keeps the root's own staged paths as they are", () => {
    expect(rootPathsOf(repoRoot, ["scripts/lint/lint.ts"])).toEqual([
      "scripts/lint/lint.ts",
    ]);
  });
});

function checkPackage(
  name: string,
  path: string,
  scripts: Record<string, string>,
): CheckPackage {
  return { name, path, excludedPaths: [], dependencies: [], scripts };
}

function labelsOf(
  selected: CheckPackage[],
  packages: CheckPackage[],
): string[] {
  return packageLintCommandsOf(selected, packages).map(commandLabelOf);
}
