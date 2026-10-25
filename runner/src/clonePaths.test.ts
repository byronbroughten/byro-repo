import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { clonePathsOf } from "./clonePaths.ts";
import { git, GitFixture } from "./GitFixture.ts";

let fixture: GitFixture;
let folder: string;
let primaryRoot: string;

beforeAll(() => {
  fixture = GitFixture.init(
    {
      "byro-repo": ".",
      personal: "packages/writing",
      "sheets-framework": "packages/framework",
      utils: "packages/utils",
    },
    {
      gitignoreOf: () => "",
      addUntracked: (root) => {
        mkdirSync(join(root, "packages", "stray"));
        packageFile(root, "packages/framework", "framework", ["utils"]);
        packageFile(root, "packages/utils", "utils", []);
      },
    },
  );
  folder = mkdtempSync(join(tmpdir(), "clone-paths-"));
  fixture.copyTo(folder);
  primaryRoot = join(folder, "byro-repo");
});

afterAll(() => {
  fixture.remove();
  rmSync(folder, { recursive: true, force: true });
});

describe("clonePathsOf", () => {
  it("keys each clone by its origin repo name, whatever its folder, and ignores a folder with no .git", () => {
    expect(clonePathsOf(primaryRoot)).toEqual({
      "byro-repo": ".",
      personal: "packages/writing",
      "sheets-framework": "packages/framework",
      utils: "packages/utils",
    });
  });

  it("lists the root first, then each clone after every clone it depends on", () => {
    expect(Object.keys(clonePathsOf(primaryRoot))).toEqual([
      "byro-repo",
      "utils",
      "sheets-framework",
      "personal",
    ]);
  });

  it("refuses two clones with one origin repo name, naming both folders", () => {
    const twins = mkdtempSync(join(tmpdir(), "clone-paths-twins-"));
    fixture.copyTo(twins);
    const root = join(twins, "byro-repo");
    const utilsRemote = git(
      join(root, "packages/utils"),
      "remote",
      "get-url",
      "origin",
    );
    git(
      join(root, "packages/writing"),
      "remote",
      "set-url",
      "origin",
      utilsRemote,
    );

    expect(() => clonePathsOf(root)).toThrow(
      "packages/utils and packages/writing both have origin repo utils",
    );
    rmSync(twins, { recursive: true, force: true });
  });
});

function packageFile(
  root: string,
  clonePath: string,
  name: string,
  dependencies: string[],
): void {
  writeFileSync(
    join(root, clonePath, "package.json"),
    JSON.stringify({
      name,
      dependencies: Object.fromEntries(dependencies.map((dep) => [dep, "*"])),
    }),
  );
}
