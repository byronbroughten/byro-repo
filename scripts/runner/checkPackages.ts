// byro-repo's packages for its checks, read from package.json files; the generic Checks never sees this list.
import { existsSync, globSync, readFileSync } from "node:fs";
import { basename, join } from "node:path";

export interface CheckPackage {
  name: string;
  path: string;
  // The other packages' paths, for the root package; empty for every other.
  excludedPaths: string[];
  dependencies: string[];
  scripts: Record<string, string>;
}

interface PackageJson {
  name: string;
  workspaces?: string[];
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
  scripts?: Record<string, string>;
}

interface ReadPackage {
  name: string;
  path: string;
  json: PackageJson;
}

// A change to one of these puts every package back into checking.
export const sharedRootFiles = [
  "package.json",
  "eslint.config.mjs",
  "vitest.config.ts",
  ".prettierignore",
];

export const rootPackageName = "root";

export function checkPackagesOf(root: string): CheckPackage[] {
  const rootJson = packageJsonOf(root);
  const workspaces = (rootJson.workspaces ?? []).flatMap((pattern) =>
    globSync(pattern, { cwd: root })
      .filter((path) => existsSync(join(root, path, "package.json")))
      .sort()
      .map((path) => ({
        name: basename(path),
        path,
        json: packageJsonOf(join(root, path)),
      })),
  );
  const readPackages: ReadPackage[] = [
    { name: rootPackageName, path: ".", json: rootJson },
    ...workspaces,
  ];
  const nameByNpmName = new Map(
    workspaces.map(({ name, json }) => [json.name, name]),
  );
  return readPackages.map(({ name, path, json }) => ({
    name,
    path,
    // The root package is the root repo's files outside every other package.
    excludedPaths:
      name === rootPackageName ? workspaces.map((pkg) => pkg.path) : [],
    dependencies: dependencyNamesOf(json, nameByNpmName),
    scripts: json.scripts ?? {},
  }));
}

export function isRootPackage({ name }: CheckPackage): boolean {
  return name === rootPackageName;
}

// The names in a comma-separated CHECK_PACKAGES value; none when it is unset or blank.
export function packageNamesOf(packageNamesText: string | undefined): string[] {
  return (packageNamesText ?? "")
    .split(",")
    .map((name) => name.trim())
    .filter((name) => name !== "");
}

// The packages a CHECK_PACKAGES value names, or every package when it names none.
export function selectedPackagesOf(
  packages: CheckPackage[],
  packageNamesText: string | undefined,
): CheckPackage[] {
  const names = packageNamesOf(packageNamesText);
  if (names.length === 0) return packages;
  const unknown = names.filter(
    (name) => !packages.some((pkg) => pkg.name === name),
  );
  if (unknown.length > 0) {
    const known = packages.map((pkg) => pkg.name).join(", ");
    throw new Error(
      `CHECK_PACKAGES names ${unknown.join(", ")}, which is no package; the packages are ${known}.`,
    );
  }
  return packages.filter((pkg) => names.includes(pkg.name));
}

function packageJsonOf(folder: string): PackageJson {
  return JSON.parse(
    readFileSync(join(folder, "package.json"), "utf8"),
  ) as PackageJson;
}

function dependencyNamesOf(
  json: PackageJson,
  nameByNpmName: Map<string, string>,
): string[] {
  return Object.keys({ ...json.dependencies, ...json.devDependencies }).flatMap(
    (npmName) => {
      const name = nameByNpmName.get(npmName);
      return name === undefined ? [] : [name];
    },
  );
}
