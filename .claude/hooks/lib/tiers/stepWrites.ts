// The step write rule: where a write is tier 1. Pure; the caller passes the file-system lookups, so a runner step's Edit or Write is decided without touching the disk.
import { isAbsolute } from "node:path";

import { WritePathResolver, type WritePlaces } from "./WritePathResolver.ts";

// Where a call runs, for resolving a relative path it writes or opens.
export interface ShellPlaces extends WritePlaces {
  cwd: string;
  // True for a regular file, symlinks followed, so `open` of a folder or app bundle isn't freed.
  isFile: (path: string) => boolean;
}

// The hooks' per-session state, which a write could forge, such as a chore's dry-run record.
const guardrailStateDir = "claude-guardrails";

// A path passes when it resolves strictly inside the workspace, $TMPDIR or /tmp and isn't .git at any depth: a workspace's .git points into the primary's git folder.
export function isStepWritable(path: string, places: WritePlaces): boolean {
  if (!isAbsolute(path)) return false;
  const resolver = WritePathResolver.init(places);
  const resolved = resolver.resolvedPathOf(path);
  if (resolved === undefined) return false;
  if (resolver.partsInside(resolved, places.workspaceRoot)) {
    return (
      resolver.partsClearOfGit(resolved, places.workspaceRoot) !== undefined
    );
  }
  const tmpParts = resolver.tmpPartsOf(resolved);
  return tmpParts !== undefined && tmpParts[0] !== guardrailStateDir;
}
