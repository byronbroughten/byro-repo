// Which files the guardrail hooks gate: project files outside the ignored folders, and as code the set `eslint .` lints, minus each package's generatedDir. Pure; shared by readFirstGate.ts and formatAndLint.ts.
import { isAbsolute, join, relative, resolve, sep } from "node:path";

const workspacesRoot = join(".claude", "worktrees") + sep;
const lintedFiles = {
  extensions: [".ts", ".js", ".mjs"],
  ignoredDirs: new Set(["node_modules", ".git", "dist", "coverage"]),
} as const;

export interface FileLocation {
  projectDir: string;
  cwd: string | undefined;
  filePath: string;
}

interface LintSetTarget extends FileLocation {
  generatedDirs: string[];
}

// generatedDirs are root-relative, one per package's sheets.config.json.
export function isInLintSet({
  generatedDirs,
  ...location
}: LintSetTarget): boolean {
  return isLintedSource(rootRelative(location), generatedDirs);
}

// target is root-relative.
export function isLintedSource(
  target: string,
  generatedDirs: string[],
): boolean {
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

// The root that holds a file: the workspace's for a path inside one, else the project's.
export function rootOf(location: FileLocation): string {
  const target = projectRelative(location);
  if (!target.startsWith(workspacesRoot)) return location.projectDir;
  const [workspace = ""] = target.slice(workspacesRoot.length).split(sep);
  return join(location.projectDir, workspacesRoot, workspace);
}

export function rootRelative(location: FileLocation): string {
  const { projectDir, cwd, filePath } = location;
  return relative(rootOf(location), resolve(cwd ?? projectDir, filePath));
}

// `eslint .` lints every code file in the project outside its ignored folders, at any depth.
function isLinted(target: string): boolean {
  if (!isUnignoredProjectFile(target)) return false;
  return lintedFiles.extensions.some((extension) => target.endsWith(extension));
}

// target is root-relative; false outside the project or in an ignored folder.
export function isUnignoredProjectFile(target: string): boolean {
  if (!target || target.startsWith("..") || isAbsolute(target)) return false;
  return !target
    .split(sep)
    .slice(0, -1)
    .some((dir) => lintedFiles.ignoredDirs.has(dir));
}
