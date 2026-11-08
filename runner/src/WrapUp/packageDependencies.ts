const dependencyFields = [
  "dependencies",
  "devDependencies",
  "optionalDependencies",
  "peerDependencies",
] as const;

type PackageManifest = Partial<
  Record<(typeof dependencyFields)[number], Record<string, string>>
>;

export function dependencyRangesOf(
  packageJsonText: string,
): Map<string, string> {
  const manifest = JSON.parse(packageJsonText) as PackageManifest;
  return new Map(
    dependencyFields.flatMap((field) => Object.entries(manifest[field] ?? {})),
  );
}
