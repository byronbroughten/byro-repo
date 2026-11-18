// `npm run size`: each named file's characters, lines and estimated tokens, largest first, then their total; counts, never contents.
// The core is sizeReport.ts; this lists the non-ignored files of the root repo and each package clone, and prints its report.
import { execFileSync } from "node:child_process";
import { existsSync, readdirSync } from "node:fs";
import { join } from "node:path";

import { sizeReportOf } from "./sizeReport.ts";

const usage =
  "Usage: npm run size -- <paths|globs|dirs> [--total]; paths are from the repo root, and --total prints only the total row";

const root = process.cwd();
try {
  process.stdout.write(
    sizeReportOf({
      root,
      files: nonIgnoredFilesOf(root),
      args: process.argv.slice(2),
    }),
  );
} catch (error) {
  console.error(
    `${error instanceof Error ? error.message : String(error)}\n${usage}`,
  );
  process.exitCode = 1;
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
