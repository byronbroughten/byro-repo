// Decides the prose gate: an edit to a tracked markdown file waits for a full read of docs/prose-style.md this session. Pure; proseGate.ts does the I/O.
import { join, sep } from "node:path";

import {
  type FileLocation,
  isUnignoredProjectFile,
  projectRelative,
} from "./lintSet.ts";
import {
  type EditDecision,
  isFullDocRead,
  type StyleRead,
} from "./styleGate.ts";

export const proseGateReason =
  "Read docs/prose-style.md before your first markdown edit this session, then retry. " +
  "Use a full Read with no offset or limit (a partial read isn't recorded; a whole-file `cat` counts), and skip docs/prose-style/ unless a rule's line doesn't decide your case.";
export const prosePath = ["docs", "prose-style.md"].join(sep);
const ungatedRoots = [
  ["packages", "writing"],
  ["docs", "agents", "outcomes"],
].map((parts) => parts.join(sep) + sep);

interface EditTarget extends FileLocation {
  hasReadProse: boolean;
}

export function editDecision({
  hasReadProse,
  ...location
}: EditTarget): EditDecision {
  return {
    denyReason:
      isGatedProse(projectRelative(location)) && !hasReadProse
        ? proseGateReason
        : undefined,
  };
}

function isGatedProse(target: string): boolean {
  if (!target.endsWith(".md") || !isUnignoredProjectFile(target)) return false;
  return !ungatedRoots.some((root) => target.startsWith(root));
}

export function isProseRead(read: StyleRead): boolean {
  return isFullDocRead(read, prosePath);
}

// wholeFilePaths are absolute, as BashReads.wholeFilePaths returns them.
export function isProseBashRead(
  projectDir: string,
  wholeFilePaths: string[],
): boolean {
  return wholeFilePaths.includes(join(projectDir, prosePath));
}
