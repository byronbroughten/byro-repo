// Decides the read-first gate: an edit a row covers waits for a full read of that row's doc this session. Pure; readFirstGate.ts does the I/O.
import { join, sep } from "node:path";

import { type EditDecision, fullReadHowTo } from "./fullDocRead.ts";
import {
  type FileLocation,
  isLintedSource,
  isUnignoredProjectFile,
  projectRelative,
} from "./lintSet.ts";

// marker names the session's record of a full read of docPath.
export interface ReadFirstRow {
  docPath: string;
  docName: string;
  marker: string;
  rules: string[];
  covers: (target: string, generatedDirs: string[]) => boolean;
}

// generatedDirs are project-relative, one per package's sheets.config.json.
export interface ReadFirstEdit extends FileLocation {
  generatedDirs: string[];
}

export const tierTablePath = join("docs", "targets-and-gates.md");
export const codeStylePath = join("config", "docs", "code-style.md");
export const proseStylePath = join("docs", "prose-style.md");
const workspacesRoot = join(".claude", "worktrees") + sep;
const tierCode = {
  folder: join(".claude", "hooks", "lib", "tiers") + sep,
  files: new Set([
    join(".claude", "hooks", "tierGate.ts"),
    join(".claude", "hooks", "gmailGate.ts"),
    join("runner", "src", "claudeWriteDecision.ts"),
  ]),
} as const;
const proseSkippedRoots = [
  join("packages", "writing"),
  join("docs", "agents", "outcomes"),
].map((root) => root + sep);

export const readFirstRows: ReadFirstRow[] = [
  {
    docPath: tierTablePath,
    docName: "the tier table",
    marker: "tiers-read",
    rules: [
      "Change a tier rule only when your ticket or the developer's request calls for it; then no extra yes is needed. When neither does, leave the rule alone and don't ask.",
      "The tier table and the tier code change in the same commit.",
    ],
    covers: (target) =>
      isTierCode(rootRelative(target)) || isSettingsFile(target),
  },
  {
    docPath: codeStylePath,
    docName: "the code rules",
    marker: "style-read",
    rules: [
      skipReasoningRule(join("config", "docs", "code-style") + sep),
      "Framework or app code also follows packages/framework/docs/code-style.md.",
    ],
    covers: isLintedSource,
  },
  {
    docPath: proseStylePath,
    docName: "the prose rules",
    marker: "prose-read",
    rules: [skipReasoningRule(join("docs", "prose-style") + sep)],
    covers: isGatedProse,
  },
];

// docsRead are project-relative; a row whose rule throws fails open alone.
export function readFirstDecision(
  { generatedDirs, ...location }: ReadFirstEdit,
  docsRead: string[],
  rows: ReadFirstRow[] = readFirstRows,
): EditDecision {
  const target = projectRelative(location);
  const missing = rows.filter(
    (row) =>
      !docsRead.includes(row.docPath) && isCovered(row, target, generatedDirs),
  );
  return {
    denyReason: missing.length > 0 ? readFirstReason(missing) : undefined,
  };
}

function isCovered(
  row: ReadFirstRow,
  target: string,
  generatedDirs: string[],
): boolean {
  try {
    return row.covers(target, generatedDirs);
  } catch {
    return false;
  }
}

function readFirstReason(missing: ReadFirstRow[]): string {
  const docs = missing.map((row) => `${row.docPath} (${row.docName})`);
  const rules = missing.flatMap((row) => row.rules).join(" ");
  return (
    `Read ${docs.join(" and ")} in full before this edit, then retry. ` +
    `${fullReadHowTo}. ${rules}`
  );
}

function skipReasoningRule(reasoningDir: string): string {
  return `Skip ${reasoningDir} unless a rule's line doesn't decide your case.`;
}

function isTierCode(target: string): boolean {
  return target.startsWith(tierCode.folder) || tierCode.files.has(target);
}

// Relative to the workspace root for a path inside a workspace, else unchanged.
function rootRelative(target: string): string {
  if (!target.startsWith(workspacesRoot)) return target;
  return target.split(sep).slice(3).join(sep);
}

// A settings file at any root: the primary root, a package or a workspace.
function isSettingsFile(target: string): boolean {
  if (target.startsWith("..")) return false;
  const parts = target.split(sep);
  const fileName = parts.at(-1) ?? "";
  return (
    parts.at(-2) === ".claude" &&
    fileName.startsWith("settings") &&
    fileName.endsWith(".json")
  );
}

function isGatedProse(target: string): boolean {
  if (!target.endsWith(".md") || !isUnignoredProjectFile(target)) return false;
  return !proseSkippedRoots.some((root) => target.startsWith(root));
}
