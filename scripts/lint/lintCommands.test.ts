import { join } from "node:path";

import { describe, expect, it } from "vitest";

import {
  type Command,
  failedCommandsOf,
  hooksPathOf,
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

describe("hooksPathOf", () => {
  it("points a clone back at the root's .githooks", () => {
    expect(hooksPathOf("packages/framework")).toBe("../../.githooks");
  });
});
