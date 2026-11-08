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
  const base = await git(clone, "merge-base", "master", branch);
  const changed = await git(
    clone,
    "diff",
    "--name-only",
    "--no-renames",
    `master...${branch}`,
  );
  const added: AddedDependency[] = [];
  for (const path of lines(changed).filter(isPackageJsonPath)) {
    const before = dependencyRangesOf(
      await packageJsonTextAt({ clone, rev: base, path }),
    );
    const after = dependencyRangesOf(
      await packageJsonTextAt({ clone, rev: branch, path }),
    );
    for (const name of after.keys()) {
      if (!before.has(name)) added.push({ repo, path, name });
    }
  }
  return added;
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

async function isDependencyChanged({
  clone,
  from,
  to,
}: DependencyComparison): Promise<boolean> {
  // No rename detection, so a moved package.json is seen at both its paths.
  const changed = await git(
    clone,
    "diff",
    "--name-only",
    "--no-renames",
    from,
    to,
  );
  for (const path of lines(changed).filter(isPackageJsonPath)) {
    const before = dependencyRangesOf(
      await packageJsonTextAt({ clone, rev: from, path }),
    );
    const after = dependencyRangesOf(
      await packageJsonTextAt({ clone, rev: to, path }),
    );
    if (!areSameRanges({ before, after })) return true;
  }
  return false;
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
