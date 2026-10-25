import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { runKnobs } from "./runnerConfig.ts";

const primaryRoot = join(import.meta.dirname, "..", "..");

interface PackageFile {
  name: string;
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
  peerDependencies?: Record<string, string>;
}

describe("runKnobs", () => {
  it("lists each clone after every clone it depends on, the order wrap-up lands them in", () => {
    const clones = Object.values(runKnobs.clonePaths)
      .filter((clonePath) => clonePath !== ".")
      // CI checks out only this repo, so its clones are absent there.
      .filter((clonePath) => existsSync(packageFilePathOf(clonePath)))
      .map((clonePath) => packageFileOf(clonePath));
    const cloneNames = clones.map(({ name }) => name);

    const outOfOrder = clones.flatMap((clone, index) =>
      dependencyNamesOf(clone)
        .filter((name) => cloneNames.indexOf(name) > index)
        .map((name) => `${clone.name} is listed before ${name}`),
    );

    expect(outOfOrder).toEqual([]);
  });
});

function packageFilePathOf(clonePath: string): string {
  return join(primaryRoot, clonePath, "package.json");
}

function packageFileOf(clonePath: string): PackageFile {
  return JSON.parse(
    readFileSync(packageFilePathOf(clonePath), "utf8"),
  ) as PackageFile;
}

function dependencyNamesOf({
  dependencies,
  devDependencies,
  peerDependencies,
}: PackageFile): string[] {
  return Object.keys({
    ...dependencies,
    ...devDependencies,
    ...peerDependencies,
  });
}
