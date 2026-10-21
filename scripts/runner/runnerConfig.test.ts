import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

const primaryRoot = join(import.meta.dirname, "..", "..");

interface PackageFile {
  name: string;
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
  peerDependencies?: Record<string, string>;
}

describe("runner.config.json", () => {
  it("lists each clone after every clone it depends on, the order wrap-up lands them in", () => {
    const { clonePaths } = JSON.parse(
      readFileSync(join(import.meta.dirname, "runner.config.json"), "utf8"),
    ) as { clonePaths: Record<string, string> };
    const clones = Object.values(clonePaths)
      .filter((clonePath) => clonePath !== ".")
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

function packageFileOf(clonePath: string): PackageFile {
  return JSON.parse(
    readFileSync(join(primaryRoot, clonePath, "package.json"), "utf8"),
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
