// `npm run size`: each named file's characters, lines and estimated tokens, largest first, then their total; counts, never contents.
// The core is sizeReport.ts; this parses the arguments, lists the non-ignored files of the root repo and each package clone, and prints its report.
import { execFileSync } from "node:child_process";
import { existsSync, readdirSync } from "node:fs";
import { join } from "node:path";

import { type SizeInputs, sizeTableOf, sizeTotalOf } from "./sizeReport.ts";

const usage =
  "Usage: npm run size -- <paths|globs|dirs> [--total]; paths are from the repo root, and --total prints only the total line";

const totalFlag = "--total";

const args = process.argv.slice(2);
const patterns = args.filter((arg) => arg !== totalFlag);
const argumentError = argumentErrorOf(patterns);
if (argumentError !== undefined) {
  console.error(`${argumentError}\n${usage}`);
  process.exitCode = 1;
} else {
  const root = process.cwd();
  const inputs: SizeInputs = {
    root,
    files: nonIgnoredFilesOf(root),
    patterns,
  };
  try {
    process.stdout.write(
      args.includes(totalFlag) ? sizeTotalOf(inputs) : sizeTableOf(inputs),
    );
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}

function argumentErrorOf(patterns: string[]): string | undefined {
  const unknownFlag = patterns.find((pattern) => pattern.startsWith("--"));
  if (unknownFlag !== undefined) return `unknown flag ${unknownFlag}`;
  if (patterns.length === 0) return "no file named";
  return undefined;
}

// The root repo ignores packages/*, each its own clone, so each clone lists its own files.
function nonIgnoredFilesOf(primaryRoot: string): string[] {
  return [".", ...cloneFoldersOf(primaryRoot)].flatMap((folder) =>
    gitFilesOf(primaryRoot, folder),
  );
}

function cloneFoldersOf(primaryRoot: string): string[] {
  const packages = join(primaryRoot, "packages");
  if (!existsSync(packages)) return [];
  return readdirSync(packages, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map(({ name }) => join("packages", name))
    .filter((folder) => existsSync(join(primaryRoot, folder, ".git")));
}

function gitFilesOf(primaryRoot: string, folder: string): string[] {
  return execFileSync(
    "git",
    ["ls-files", "-z", "--cached", "--others", "--exclude-standard"],
    { cwd: join(primaryRoot, folder), encoding: "utf8", maxBuffer: 1 << 28 },
  )
    .split("\0")
    .filter((path) => path !== "")
    .map((path) => join(folder, path));
}
