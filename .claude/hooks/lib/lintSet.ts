// Which files the guardrail hooks treat as code: the set `eslint .` lints, minus each package's generatedDir. Pure; shared by styleGate.ts and lintFeedback.ts.
import { isAbsolute, join, relative, resolve, sep } from "node:path";

const lintedFiles = {
  extensions: [".ts", ".js", ".mjs"],
  ignoredDirs: new Set(["node_modules", ".git", "dist", "coverage"]),
  ignoredRoot: join(".claude", "worktrees") + sep,
} as const;

export interface FileLocation {
  projectDir: string;
  cwd: string | undefined;
  filePath: string;
}

interface LintSetTarget extends FileLocation {
  generatedDirs: string[];
}

// generatedDirs are project-relative, one per package's sheets.config.json.
export function isInLintSet({
  generatedDirs,
  ...location
}: LintSetTarget): boolean {
  const target = projectRelative(location);
  const isGenerated = generatedDirs.some((dir) => target.startsWith(dir + sep));
  return isLinted(target) && !isGenerated;
}

export function projectRelative({
  projectDir,
  cwd,
  filePath,
}: FileLocation): string {
  return relative(projectDir, resolve(cwd ?? projectDir, filePath));
}

// `eslint .` lints every code file in the project outside its ignored folders, at any depth.
function isLinted(target: string): boolean {
  if (!target || target.startsWith("..") || isAbsolute(target)) return false;
  if (
    target
      .split(sep)
      .slice(0, -1)
      .some((dir) => lintedFiles.ignoredDirs.has(dir))
  ) {
    return false;
  }
  if (target.startsWith(lintedFiles.ignoredRoot)) return false;
  return lintedFiles.extensions.some((extension) => target.endsWith(extension));
}
