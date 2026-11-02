// The lint commands lint.ts and preCommit.ts share, the runner that runs every one of them, and the hook paths prepare.ts sets and how it sets them.
import { spawnSync } from "node:child_process";
import { basename, join, relative } from "node:path";

export type Command = [string, ...string[]];

export const repoRoot = join(import.meta.dirname, "../..");

const codeExtensions = [".ts", ".js", ".mjs"];

// Each package's own eslint.config.mjs is found by the lookup flag.
export function eslintOf(paths: string[]): Command {
  return [
    binOf("eslint"),
    "--flag",
    "v10_config_lookup_from_file",
    "--no-warn-ignored",
    ...paths,
  ];
}

// Only .prettierignore: Prettier's default also reads .gitignore, whose `packages/*` would skip every clone's files.
export function prettierCheckOf(paths: string[]): Command {
  return [
    binOf("prettier"),
    "--check",
    "--ignore-unknown",
    "--ignore-path",
    join(repoRoot, ".prettierignore"),
    ...paths,
  ];
}

export function isCode(path: string): boolean {
  return codeExtensions.some((extension) => path.endsWith(extension));
}

// Every command runs even after one fails, so a red step never hides the next.
export function failedCommandsOf(
  commands: Command[],
  cwd = repoRoot,
): Command[] {
  const failed: Command[] = [];
  commands.forEach((command) => {
    const [file, ...args] = command;
    const { status } = spawnSync(file, args, { cwd, stdio: "inherit" });
    if (status !== 0) failed.push(command);
  });
  return failed;
}

// A clone's staged paths are relative to the clone; Prettier and ESLint run from the root.
export function rootPathsOf(cloneRoot: string, paths: string[]): string[] {
  const prefix = relative(repoRoot, cloneRoot);
  return paths.map((path) => join(prefix, path));
}

// Relative, so a workspace clone, sharing its primary's config, finds its own root's hooks.
export function hooksPathOf(clonePath: string): string {
  return relative(clonePath, ".githooks");
}

// Reads before writing: Claude Code's sandbox protects .git/config even inside an allowed .git, so a boxed npm install must not write a value already set.
export function setHooksPath(cloneRoot: string, hooksPath: string): void {
  if (hooksPathIn(cloneRoot) === hooksPath) return;
  const { status, stderr } = spawnSync(
    "git",
    ["config", "core.hooksPath", hooksPath],
    { cwd: cloneRoot, encoding: "utf8" },
  );
  if (status === 0) return;
  throw new Error(
    `Claude Code's sandbox protects .git/config, so core.hooksPath in ${cloneRoot} can't change from inside it. Run \`git -C ${cloneRoot} config core.hooksPath ${hooksPath}\` in a Bash call of its own. git: ${stderr.trim()}`,
  );
}

export function commandLabelOf([file, ...args]: Command): string {
  return [basename(file), ...args].join(" ");
}

// git config --get exits 1 when the key is unset.
function hooksPathIn(cloneRoot: string): string | undefined {
  const { status, stdout } = spawnSync(
    "git",
    ["config", "--get", "core.hooksPath"],
    { cwd: cloneRoot, encoding: "utf8" },
  );
  if (status !== 0) return undefined;
  return stdout.trim();
}

function binOf(name: string): string {
  return join(repoRoot, "node_modules", ".bin", name);
}
