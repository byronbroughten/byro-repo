// What every full-read gate shares: whether a Read or a Bash read covered a whole doc, the deny message's wording, and the decision shape. Pure; used by the read-first and doc content gates.
import { join } from "node:path";

import { type FileLocation, projectRelative } from "./lintSet.ts";

export interface EditDecision {
  denyReason: string | undefined;
}

export interface ReadBounds {
  offset?: number;
  limit?: number;
}

export interface FullDocRead extends FileLocation, ReadBounds {
  totalLines: number | undefined;
}

export const fullReadHowTo =
  "Use a full Read with no offset or limit (a partial read isn't recorded; a whole-file `cat` counts)";

export function isFullDocRead(
  { projectDir, cwd, filePath, offset, limit, totalLines }: FullDocRead,
  docPath: string,
): boolean {
  if (projectRelative({ projectDir, cwd, filePath }) !== docPath) return false;
  if (offset == null && limit == null) return true;
  if ((offset ?? 1) > 1) return false;
  return (
    limit == null ||
    (totalLines !== undefined &&
      Number.isInteger(totalLines) &&
      limit >= totalLines)
  );
}

// wholeFilePaths are absolute, as BashReads.wholeFilePaths returns them.
export function isFullDocBashRead(
  projectDir: string,
  wholeFilePaths: string[],
  docPath: string,
): boolean {
  return wholeFilePaths.includes(join(projectDir, docPath));
}
