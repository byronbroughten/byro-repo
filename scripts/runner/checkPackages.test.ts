import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { beforeAll, describe, expect, it } from "vitest";

import {
  type CheckPackage,
  checkPackagesOf,
  selectedPackagesOf,
  sharedRootFiles,
} from "./checkPackages.ts";

let root: string;

beforeAll(() => {
  root = mkdtempSync(join(tmpdir(), "check-packages-"));
  writePackage(".", {
    name: "repo",
    workspaces: ["config", "runner", "packages/*"],
    dependencies: { "@x/runner": "*" },
    devDependencies: { "@x/config": "^0.1.0", typescript: "^5.9.2" },
    scripts: { tsc: "tsc -p .", "lint:docs": "lint-docs" },
  });
  writePackage("config", { name: "@x/config" });
  writePackage("runner", {
    name: "@x/runner",
    devDependencies: { "@x/config": "^0.1.0" },
  });
  writePackage("packages/framework", {
    name: "@x/framework",
    devDependencies: { "@x/config": "^0.1.0", "@x/utils": "^0.1.0" },
  });
  writePackage("packages/utils", { name: "@x/utils" });
  writePackage("packages/app", {
    name: "app",
    dependencies: { "@x/framework": "*", "@x/utils": "^0.1.0" },
  });
  // A folder the workspace glob matches but that holds no package.
  mkdirSync(join(root, "packages/notes"));
});

describe("checkPackagesOf", () => {
  it("lists the root and each workspace with its path", () => {
    expect(
      checkPackagesOf(root).map(({ name, path }) => ({ name, path })),
    ).toEqual([
      { name: "root", path: "." },
      { name: "config", path: "config" },
      { name: "runner", path: "runner" },
      { name: "app", path: "packages/app" },
      { name: "framework", path: "packages/framework" },
      { name: "utils", path: "packages/utils" },
    ]);
  });

  it("reads each package's dependencies on other packages from its dependencies and devDependencies", () => {
    expect(dependenciesByName()).toEqual({
      root: ["runner", "config"],
      config: [],
      runner: ["config"],
      app: ["framework", "utils"],
      framework: ["config", "utils"],
      utils: [],
    });
  });

  it("carves every other package out of the root package", () => {
    expect(packageNamed("root").excludedPaths).toEqual([
      "config",
      "runner",
      "packages/app",
      "packages/framework",
      "packages/utils",
    ]);
    expect(packageNamed("framework").excludedPaths).toEqual([]);
  });

  it("keeps each package's own scripts", () => {
    expect(packageNamed("root").scripts).toEqual({
      tsc: "tsc -p .",
      "lint:docs": "lint-docs",
    });
    expect(packageNamed("utils").scripts).toEqual({});
  });
});

describe("sharedRootFiles", () => {
  it("are the four root files every package's checks read", () => {
    expect(sharedRootFiles).toEqual([
      "package.json",
      "eslint.config.mjs",
      "vitest.config.ts",
      ".prettierignore",
    ]);
  });
});

describe("selectedPackagesOf", () => {
  it("selects every package when none is named", () => {
    expect(names(selectedPackagesOf(checkPackagesOf(root), undefined))).toEqual(
      ["root", "config", "runner", "app", "framework", "utils"],
    );
    expect(names(selectedPackagesOf(checkPackagesOf(root), ""))).toHaveLength(
      6,
    );
  });

  it("selects only the comma-separated packages named", () => {
    expect(
      names(selectedPackagesOf(checkPackagesOf(root), "utils, root")),
    ).toEqual(["root", "utils"]);
  });

  it("refuses a name that is no package", () => {
    expect(() =>
      selectedPackagesOf(checkPackagesOf(root), "root,nope"),
    ).toThrow(
      "CHECK_PACKAGES names nope, which is no package; the packages are root, config, runner, app, framework, utils.",
    );
  });
});

function writePackage(path: string, json: object): void {
  mkdirSync(join(root, path), { recursive: true });
  writeFileSync(join(root, path, "package.json"), JSON.stringify(json));
}

function packageNamed(name: string): CheckPackage {
  const found = checkPackagesOf(root).find((pkg) => pkg.name === name);
  if (found === undefined) throw new Error(`no package ${name}`);
  return found;
}

function dependenciesByName(): Record<string, string[]> {
  return Object.fromEntries(
    checkPackagesOf(root).map(({ name, dependencies }) => [name, dependencies]),
  );
}

function names(packages: CheckPackage[]): string[] {
  return packages.map(({ name }) => name);
}
