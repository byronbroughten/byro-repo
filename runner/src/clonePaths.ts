// The repo map every runner reader takes: repo name to its clone's path relative to the primary root, built from each clone's origin remote.
// The root repo's path is "."; each clone follows every clone it depends on, the order wrap-up lands them in.
import { execFileSync } from "node:child_process";
import { type Dirent, existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

interface Clone {
  repo: string;
  clonePath: string;
  packageName?: string;
  dependencyNames: string[];
}

export function clonePathsOf(primaryRoot: string): Record<string, string> {
  const clones = packageFoldersOf(primaryRoot)
    .filter((entry) => entry.isDirectory())
    .map(({ name }) => join("packages", name))
    .sort()
    .filter((clonePath) => existsSync(join(primaryRoot, clonePath, ".git")))
    .map((clonePath) => cloneOf(primaryRoot, clonePath));
  return dependencyOrderOf(clones).reduce<Record<string, string>>(
    (paths, { repo, clonePath }) => {
      if (paths[repo] !== undefined) {
        throw new Error(
          `${paths[repo]} and ${clonePath} both have origin repo ${repo}`,
        );
      }
      paths[repo] = clonePath;
      return paths;
    },
    { [originRepoOf(primaryRoot, ".")]: "." },
  );
}

// A checkout of the root repo alone, such as CI's, has no packages folder.
function packageFoldersOf(primaryRoot: string): Dirent[] {
  const folder = join(primaryRoot, "packages");
  if (!existsSync(folder)) return [];
  return readdirSync(folder, { withFileTypes: true });
}

function cloneOf(primaryRoot: string, clonePath: string): Clone {
  const packageFilePath = join(primaryRoot, clonePath, "package.json");
  const packageFile = existsSync(packageFilePath)
    ? (JSON.parse(readFileSync(packageFilePath, "utf8")) as PackageFile)
    : {};
  return {
    repo: originRepoOf(primaryRoot, clonePath),
    clonePath,
    packageName: packageFile.name,
    dependencyNames: Object.keys({
      ...packageFile.dependencies,
      ...packageFile.devDependencies,
      ...packageFile.peerDependencies,
    }),
  };
}

interface PackageFile {
  name?: string;
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
  peerDependencies?: Record<string, string>;
}

// The last segment of the origin URL, so an https, ssh or local-path remote all give the bare repo name.
function originRepoOf(primaryRoot: string, clonePath: string): string {
  const folder = join(primaryRoot, clonePath);
  if (!gitIn(folder, "remote").split("\n").includes("origin")) {
    throw new Error(`${clonePath} has a .git but no origin remote`);
  }
  return gitIn(folder, "remote", "get-url", "origin")
    .replace(/\/+$/, "")
    .replace(/\.git$/, "")
    .split(/[/:]/)
    .at(-1) as string;
}

function gitIn(folder: string, ...args: string[]): string {
  return execFileSync("git", args, {
    cwd: folder,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  }).trim();
}

// Folder order, except that a clone waits for every clone whose package it depends on.
function dependencyOrderOf(clones: Clone[]): Clone[] {
  const ordered: Clone[] = [];
  const visited = new Set<Clone>();
  function visit(clone: Clone): void {
    if (visited.has(clone)) return;
    visited.add(clone);
    clones
      .filter(
        (other) =>
          other !== clone &&
          other.packageName !== undefined &&
          clone.dependencyNames.includes(other.packageName),
      )
      .forEach(visit);
    ordered.push(clone);
  }
  clones.forEach(visit);
  return ordered;
}
