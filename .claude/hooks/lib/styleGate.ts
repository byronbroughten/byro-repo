// Decides the style gate: an edit to a file ESLint lints waits for a full read of config/docs/code-style.md this session. Pure; styleGate.ts does the I/O.
import { sep } from "node:path";

import {
  type EditDecision,
  type FullDocRead,
  fullReadReason,
  isFullDocBashRead,
  isFullDocRead,
  type ReadBounds,
} from "./fullDocRead.ts";
import { type FileLocation, isInLintSet, projectRelative } from "./lintSet.ts";

const styleDocReason = fullReadReason({
  docPath: "config/docs/code-style.md",
  reasoningDir: "config/docs/code-style/",
  editKind: "code",
});
export const styleGateReason = `${styleDocReason} Framework or app code also follows packages/framework/docs/code-style.md.`;
export const stylePath = ["config", "docs", "code-style.md"].join(sep);
export const frameworkStylePath = [
  "packages",
  "framework",
  "docs",
  "code-style.md",
].join(sep);
const frameworkOrAppRoots = ["framework", "real-estate"].map(
  (packageName) => ["packages", packageName].join(sep) + sep,
);

interface EditTarget extends FileLocation {
  hasReadStyle: boolean;
  generatedDirs: string[];
}

interface CursorEditTarget extends FileLocation {
  generatedDirs: string[];
  reads: RecordedStyleReads;
}

export function editDecision({
  hasReadStyle,
  ...target
}: EditTarget): EditDecision {
  return {
    denyReason:
      isInLintSet(target) && !hasReadStyle ? styleGateReason : undefined,
  };
}

export interface RecordedStyleReads {
  hasReadGeneral: boolean;
  hasReadFramework: boolean;
}

const fullReadClause =
  "Use a full Read with no offset or limit (a partial Read isn't recorded), and skip the docs/code-style/ reasoning files unless a rule's line doesn't decide your case.";

function needsFrameworkStyle(relativePath: string): boolean {
  return frameworkOrAppRoots.some((root) => relativePath.startsWith(root));
}

export function cursorEditDecision({
  reads,
  ...target
}: CursorEditTarget): EditDecision {
  if (!isInLintSet(target)) return { denyReason: undefined };
  const missing = missingStyleDocs(projectRelative(target), reads);
  if (missing.length === 0) return { denyReason: undefined };
  return {
    denyReason: `Read ${missing.join(" and ")} before this code edit, then retry. ${fullReadClause}`,
  };
}

function missingStyleDocs(
  relativePath: string,
  reads: RecordedStyleReads,
): string[] {
  const missing: string[] = [];
  if (!reads.hasReadGeneral) missing.push(stylePath);
  if (needsFrameworkStyle(relativePath) && !reads.hasReadFramework) {
    missing.push(frameworkStylePath);
  }
  return missing;
}

export function isStyleRead(read: FullDocRead): boolean {
  return isFullDocRead(read, stylePath);
}

export function isStyleBashRead(
  projectDir: string,
  wholeFilePaths: string[],
): boolean {
  return isFullDocBashRead(projectDir, wholeFilePaths, stylePath);
}

export function cursorFilePath(
  toolInput: { path?: unknown; file_path?: unknown } | undefined,
): string | undefined {
  const filePath = toolInput?.file_path ?? toolInput?.path;
  return typeof filePath === "string" ? filePath : undefined;
}

// Undefined when a bound is present but not a whole number: that Read is not unbounded, and it is not a range we can check.
export function cursorReadBounds(
  toolInput: { offset?: unknown; limit?: unknown } | undefined,
): ReadBounds | undefined {
  const { offset, limit } = toolInput ?? {};
  if (!isAbsentOrWholeNumber(offset) || !isAbsentOrWholeNumber(limit)) {
    return undefined;
  }
  return { offset: offset ?? undefined, limit: limit ?? undefined };
}

function isAbsentOrWholeNumber(
  value: unknown,
): value is number | null | undefined {
  return (
    value == null || (typeof value === "number" && Number.isInteger(value))
  );
}
