// Decides the prose gate: an edit to a tracked markdown file waits for a full read of docs/prose-style.md this session. Pure; proseGate.ts does the I/O.
import { sep } from "node:path";

import {
  type EditDecision,
  type FullDocRead,
  fullReadReason,
  isFullDocBashRead,
  isFullDocRead,
} from "./fullDocRead.ts";
import {
  type FileLocation,
  isUnignoredProjectFile,
  projectRelative,
} from "./lintSet.ts";

export const proseGateReason = fullReadReason({
  docPath: "docs/prose-style.md",
  reasoningDir: "docs/prose-style/",
  editKind: "markdown",
});
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

export function isProseRead(read: FullDocRead): boolean {
  return isFullDocRead(read, prosePath);
}

export function isProseBashRead(
  projectDir: string,
  wholeFilePaths: string[],
): boolean {
  return isFullDocBashRead(projectDir, wholeFilePaths, prosePath);
}
