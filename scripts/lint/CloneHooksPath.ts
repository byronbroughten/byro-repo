// A clone's core.hooksPath, which prepare.ts points at the root's .githooks; the lint commands themselves are lintCommands.ts.
import { spawnSync } from "node:child_process";
import { relative } from "node:path";

export class CloneHooksPath {
  constructor(private readonly cloneRoot: string) {}

  static init(cloneRoot: string): CloneHooksPath {
    return new CloneHooksPath(cloneRoot);
  }

  // git config --get exits 1 when the key is unset.
  get hooksPath(): string | undefined {
    const { status, stdout } = spawnSync(
      "git",
      ["config", "--get", "core.hooksPath"],
      { cwd: this.cloneRoot, encoding: "utf8" },
    );
    if (status !== 0) return undefined;
    return stdout.trim();
  }

  // Reads before writing: Claude Code's sandbox protects .git/config even inside an allowed .git, so a boxed npm install must not write a value already set.
  set(hooksPath: string): void {
    if (this.hooksPath === hooksPath) return;
    const { status, stderr } = spawnSync(
      "git",
      ["config", "core.hooksPath", hooksPath],
      { cwd: this.cloneRoot, encoding: "utf8" },
    );
    if (status === 0) return;
    throw new Error(
      `Claude Code's sandbox protects .git/config, so core.hooksPath in ${this.cloneRoot} can't change from inside it. Run \`git -C ${this.cloneRoot} config core.hooksPath ${hooksPath}\` in a Bash call of its own. git: ${stderr.trim()}`,
    );
  }
}

// Relative, so a workspace clone, sharing its primary's config, finds its own root's hooks.
export function hooksPathOf(clonePath: string): string {
  return relative(clonePath, ".githooks");
}
