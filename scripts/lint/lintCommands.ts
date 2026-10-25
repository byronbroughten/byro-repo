// The lint commands lint.ts and preCommit.ts share, the runner that runs every one of them, and the hook paths prepare.ts sets.
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

export function commandLabelOf([file, ...args]: Command): string {
  return [basename(file), ...args].join(" ");
}

function binOf(name: string): string {
  return join(repoRoot, "node_modules", ".bin", name);
}
