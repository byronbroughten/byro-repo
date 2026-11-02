import { execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { callOfItsOwn } from "@byronbroughten/spec-runner/callOfItsOwn";
import { describe, expect, it } from "vitest";

import { CloneHooksPath, hooksPathOf } from "./CloneHooksPath.ts";

describe("hooksPathOf", () => {
  it("points a clone back at the root's .githooks", () => {
    expect(hooksPathOf("packages/framework")).toBe("../../.githooks");
  });
});

// A config.lock left in .git makes git's config write fail as the sandbox's protection of .git/config does.
describe("CloneHooksPath.set", () => {
  it("leaves an unchanged core.hooksPath alone, so a locked config never fails", () => {
    const repo = repoWithHooksPath(".githooks");
    lockConfigOf(repo);
    expect(() => CloneHooksPath.init(repo).set(".githooks")).not.toThrow();
  });

  it("words a failed write as the sandbox and names the command to run in a call of its own", () => {
    const repo = repoWithHooksPath("old-hooks");
    lockConfigOf(repo);
    expect(() => CloneHooksPath.init(repo).set(".githooks")).toThrow(
      `Claude Code's sandbox protects .git/config, so core.hooksPath in ${repo} can't change from inside it. ${callOfItsOwn(`Run \`git -C ${repo} config core.hooksPath .githooks\``)}.`,
    );
  });

  it("sets a differing core.hooksPath", () => {
    const repo = repoWithHooksPath("old-hooks");
    const hooks = CloneHooksPath.init(repo);
    hooks.set(".githooks");
    expect(hooks.hooksPath).toBe(".githooks");
  });
});

function repoWithHooksPath(hooksPath: string): string {
  const repo = mkdtempSync(join(tmpdir(), "prepare-"));
  execFileSync("git", ["init", "--quiet"], { cwd: repo });
  execFileSync("git", ["config", "core.hooksPath", hooksPath], { cwd: repo });
  return repo;
}

function lockConfigOf(repo: string): void {
  writeFileSync(join(repo, ".git", "config.lock"), "");
}
