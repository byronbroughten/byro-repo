import { execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import {
  type Command,
  failedCommandsOf,
  hooksPathOf,
  repoRoot,
  rootPathsOf,
  setHooksPath,
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

// A config.lock left in .git makes git's config write fail as the sandbox's protection of .git/config does.
describe("setHooksPath", () => {
  it("leaves an unchanged core.hooksPath alone, so a locked config never fails", () => {
    const repo = repoWithHooksPath(".githooks");
    lockConfigOf(repo);
    expect(() => setHooksPath(repo, ".githooks")).not.toThrow();
  });

  it("words a failed write as the sandbox and names the command to run in a call of its own", () => {
    const repo = repoWithHooksPath("old-hooks");
    lockConfigOf(repo);
    expect(() => setHooksPath(repo, ".githooks")).toThrow(
      `Claude Code's sandbox protects .git/config, so core.hooksPath in ${repo} can't change from inside it. Run \`git -C ${repo} config core.hooksPath .githooks\` in a Bash call of its own.`,
    );
  });

  it("sets a differing core.hooksPath", () => {
    const repo = repoWithHooksPath("old-hooks");
    setHooksPath(repo, ".githooks");
    expect(hooksPathIn(repo)).toBe(".githooks\n");
  });
});

function hooksPathIn(repo: string): string {
  return execFileSync("git", ["config", "--get", "core.hooksPath"], {
    cwd: repo,
    encoding: "utf8",
  });
}

function repoWithHooksPath(hooksPath: string): string {
  const repo = mkdtempSync(join(tmpdir(), "prepare-"));
  execFileSync("git", ["init", "--quiet"], { cwd: repo });
  execFileSync("git", ["config", "core.hooksPath", hooksPath], { cwd: repo });
  return repo;
}

function lockConfigOf(repo: string): void {
  writeFileSync(join(repo, ".git", "config.lock"), "");
}
