// The lint commands lint.ts and preCommit.ts share, and the runner that runs every one of them; the hook paths prepare.ts sets are CloneHooksPath.ts.
import { spawnSync } from "node:child_process";
import { basename, join, relative } from "node:path";

import { type CheckPackage, rootPackageName } from "../runner/checkPackages.ts";

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
  return prettierCheckIgnoringOf([join(repoRoot, ".prettierignore")], paths);
}

// ESLint, lint-docs and Prettier over the selected packages' files; lint.ts runs these when CHECK_PACKAGES names some.
export function packageLintCommandsOf(
  selected: CheckPackage[],
  packages: CheckPackage[],
): Command[] {
  const others = selected.filter((pkg) => pkg.name !== rootPackageName);
  const hasRoot = others.length < selected.length;
  const eslintPaths = hasRoot
    ? [".", ...unselectedOf(selected, packages).flatMap(eslintIgnoreOf)]
    : others.map(({ path }) => path);
  return [
    eslintOf(["--no-error-on-unmatched-pattern", ...eslintPaths]),
    ...selected
      .filter(({ scripts }) => scripts["lint:docs"] !== undefined)
      .map(lintDocsOf),
    ...(hasRoot ? [rootPrettierCheckOf(packages)] : []),
    ...others.map(packagePrettierCheckOf),
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

export function commandLabelOf([file, ...args]: Command): string {
  return [basename(file), ...args].join(" ");
}

function unselectedOf(
  selected: CheckPackage[],
  packages: CheckPackage[],
): CheckPackage[] {
  return packages.filter((pkg) => !selected.includes(pkg));
}

function eslintIgnoreOf({ path }: CheckPackage): string[] {
  return ["--ignore-pattern", `${path}/`];
}

function lintDocsOf({ name, path }: CheckPackage): Command {
  const command: Command = ["npm", "run", "-s", "lint:docs"];
  return name === rootPackageName ? command : [...command, "-w", path];
}

// The root's own files under its .gitignore, as format:check reads them; every other package is carved out.
function rootPrettierCheckOf(packages: CheckPackage[]): Command {
  const carvedOut = packages
    .filter(({ name }) => name !== rootPackageName)
    .map(({ path }) => `!${path}/**`);
  return [binOf("prettier"), "--check", "--ignore-unknown", ".", ...carvedOut];
}

// The root's .gitignore skips every clone, so a package reads its own .gitignore instead.
function packagePrettierCheckOf({ path }: CheckPackage): Command {
  return prettierCheckIgnoringOf(
    [join(repoRoot, ".prettierignore"), `${path}/.gitignore`],
    [path],
  );
}

function prettierCheckIgnoringOf(
  ignorePaths: string[],
  paths: string[],
): Command {
  return [
    binOf("prettier"),
    "--check",
    "--ignore-unknown",
    ...ignorePaths.flatMap((ignorePath) => ["--ignore-path", ignorePath]),
    ...paths,
  ];
}

function binOf(name: string): string {
  return join(repoRoot, "node_modules", ".bin", name);
}
