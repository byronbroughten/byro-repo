// Decides the read-first gate: an edit a row covers waits for a full read of that row's doc this session. Pure; readFirstGate.ts does the I/O.
import { join, sep } from "node:path";

import {
  type EditDecision,
  type FullDocRead,
  fullReadHowTo,
  isFullDocBashRead,
  isFullDocRead,
} from "./fullDocRead.ts";
import { type FileLocation, projectRelative } from "./lintSet.ts";

export interface ReadFirstRow {
  docPath: string;
  docName: string;
  rules: string[];
  covers: (target: string) => boolean;
}

export const tierTablePath = join("docs", "targets-and-gates.md");
const workspacesRoot = join(".claude", "worktrees") + sep;
const tierCode = {
  folder: join(".claude", "hooks", "lib", "tiers") + sep,
  files: new Set([
    join(".claude", "hooks", "tierGate.ts"),
    join(".claude", "hooks", "gmailGate.ts"),
    join("runner", "src", "claudeWriteDecision.ts"),
  ]),
} as const;

export const readFirstRows: ReadFirstRow[] = [
  {
    docPath: tierTablePath,
    docName: "the tier table",
    rules: [
      "Change a tier rule only when your ticket or the developer's request calls for it; then no extra yes is needed. When neither does, leave the rule alone and don't ask.",
      "The tier table and the tier code change in the same commit.",
    ],
    covers: (target) =>
      isTierCode(rootRelative(target)) || isSettingsFile(target),
  },
];

// docsRead are project-relative; a row whose rule throws fails open alone.
export function readFirstDecision(
  edit: FileLocation,
  docsRead: string[],
  rows: ReadFirstRow[] = readFirstRows,
): EditDecision {
  const target = projectRelative(edit);
  const missing = rows.filter(
    (row) => !docsRead.includes(row.docPath) && isCovered(row, target),
  );
  return {
    denyReason: missing.length > 0 ? readFirstReason(missing) : undefined,
  };
}

function isCovered(row: ReadFirstRow, target: string): boolean {
  try {
    return row.covers(target);
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

export function isTierTableRead(read: FullDocRead): boolean {
  return isFullDocRead(read, tierTablePath);
}

export function isTierTableBashRead(
  projectDir: string,
  wholeFilePaths: string[],
): boolean {
  return isFullDocBashRead(projectDir, wholeFilePaths, tierTablePath);
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
