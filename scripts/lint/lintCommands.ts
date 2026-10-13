// The lint commands lint.ts and preCommit.ts share, and the runner that runs every one of them.
import { spawnSync } from "node:child_process";
import { basename, join } from "node:path";

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

export function prettierCheckOf(paths: string[]): Command {
  return [binOf("prettier"), "--check", "--ignore-unknown", ...paths];
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

export function commandLabelOf([file, ...args]: Command): string {
  return [basename(file), ...args].join(" ");
}

function binOf(name: string): string {
  return join(repoRoot, "node_modules", ".bin", name);
}
