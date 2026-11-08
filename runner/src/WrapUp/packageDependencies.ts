import { git, lines } from "../git.ts";
import { type LandingBranch } from "./wrapUpTypes.ts";

const dependencyFields = [
  "dependencies",
  "devDependencies",
  "optionalDependencies",
  "peerDependencies",
] as const;

type PackageManifest = Partial<
  Record<(typeof dependencyFields)[number], Record<string, string>>
>;

// A repo and the two commits whose package.json dependencies are compared.
export interface DependencyComparison {
  clone: string;
  from: string;
  to: string;
}

export interface AddedDependency {
  repo: string;
  path: string;
  name: string;
}

interface BranchInClone extends LandingBranch {
  clone: string;
}

interface PackageJsonAtRev {
  clone: string;
  rev: string;
  path: string;
}

interface RangesPair {
  before: Map<string, string>;
  after: Map<string, string>;
}

interface ChangedPackageJson extends RangesPair {
  path: string;
}

export function dependencyRangesOf(
  packageJsonText: string,
): Map<string, string> {
  const manifest = JSON.parse(packageJsonText) as PackageManifest;
  return new Map(
    dependencyFields.flatMap((field) => Object.entries(manifest[field] ?? {})),
  );
}

// Names at the branch head and not at its merge base with master; a version change or removal adds nothing.
export async function dependenciesAddedBy({
  repo,
  branch,
  clone,
}: BranchInClone): Promise<AddedDependency[]> {
  const from = await git(clone, "merge-base", "master", branch);
  const changed = await changedPackageJsonsOf({ clone, from, to: branch });
  return changed.flatMap(({ path, before, after }) =>
    [...after.keys()]
      .filter((name) => !before.has(name))
      .map((name) => ({ repo, path, name })),
  );
}

export function addedDependencyLabelOf({
  repo,
  path,
  name,
}: AddedDependency): string {
  return `${repo} ${path} adds ${name}`;
}

export async function isAnyDependencyChanged(
  comparisons: DependencyComparison[],
): Promise<boolean> {
  for (const comparison of comparisons) {
    if (await isDependencyChanged(comparison)) return true;
  }
  return false;
}

async function isDependencyChanged(
  comparison: DependencyComparison,
): Promise<boolean> {
  const changed = await changedPackageJsonsOf(comparison);
  return changed.some((ranges) => !areSameRanges(ranges));
}

async function changedPackageJsonsOf({
  clone,
  from,
  to,
}: DependencyComparison): Promise<ChangedPackageJson[]> {
  // No rename detection, so a moved package.json is seen at both its paths.
  const changed = await git(
    clone,
    "diff",
    "--name-only",
    "--no-renames",
    from,
    to,
  );
  return Promise.all(
    lines(changed)
      .filter(isPackageJsonPath)
      .map(async (path) => ({
        path,
        before: dependencyRangesOf(
          await packageJsonTextAt({ clone, rev: from, path }),
        ),
        after: dependencyRangesOf(
          await packageJsonTextAt({ clone, rev: to, path }),
        ),
      })),
  );
}

function isPackageJsonPath(path: string): boolean {
  return path === "package.json" || path.endsWith("/package.json");
}

// A commit without the file holds no dependencies there.
async function packageJsonTextAt({
  clone,
  rev,
  path,
}: PackageJsonAtRev): Promise<string> {
  const listed = await git(clone, "ls-tree", "--name-only", rev, "--", path);
  if (listed === "") return "{}";
  return git(clone, "show", `${rev}:${path}`);
}

function areSameRanges({ before, after }: RangesPair): boolean {
  return (
    before.size === after.size &&
    [...before].every(([name, range]) => after.get(name) === range)
  );
}
