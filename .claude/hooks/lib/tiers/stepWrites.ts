// The step write rule: where a write is tier 1. Pure; the caller passes the file-system lookups, so an Edit and a Bash write get one answer.
import { dirname, isAbsolute, join, relative, sep } from "node:path";

// realPathOf is undefined when nothing is there; isLink is true for a symlink, dangling or not.
export interface WritePlaces {
  workspaceRoot: string;
  tmpDir: string;
  realPathOf: (path: string) => string | undefined;
  isLink: (path: string) => boolean;
}

// The hooks' per-session state, which a write could forge, such as a chore's dry-run record.
const guardrailStateDir = "claude-guardrails";

// A path passes when it resolves strictly inside the workspace or $TMPDIR and isn't .git at any depth: a workspace's .git points into the primary's git folder.
export function isStepWritable(path: string, places: WritePlaces): boolean {
  if (!isAbsolute(path)) return false;
  const resolved = resolvedPathOf(path, places);
  if (resolved === undefined) return false;
  if (partsInside(resolved, places.workspaceRoot, places)) {
    return (
      partsClearOfGit(resolved, places.workspaceRoot, places) !== undefined
    );
  }
  const tmpParts = partsClearOfGit(resolved, places.tmpDir, places);
  return tmpParts !== undefined && tmpParts[0] !== guardrailStateDir;
}

// The path's parts below a root, or undefined when it isn't strictly inside it or is in .git at any depth.
export function partsClearOfGit(
  resolved: string,
  root: string,
  places: WritePlaces,
): string[] | undefined {
  const parts = partsInside(resolved, root, places);
  return parts?.includes(".git") ? undefined : parts;
}

// The path's parts below a root, or undefined when it isn't strictly inside it.
export function partsInside(
  resolved: string,
  root: string,
  places: WritePlaces,
): string[] | undefined {
  const inside = relative(places.realPathOf(root) ?? root, resolved);
  if (inside === "" || isAbsolute(inside)) return undefined;
  if (inside === ".." || inside.startsWith(`..${sep}`)) return undefined;
  return inside.split(sep);
}

// Walked a part at a time, so `..` follows a symlink as the kernel does; undefined through a dangling link.
export function resolvedPathOf(
  path: string,
  places: WritePlaces,
): string | undefined {
  let current = "/";
  for (const part of path.split("/")) {
    if (part === "" || part === ".") continue;
    if (part === "..") {
      current = dirname(current);
      continue;
    }
    const next = join(current, part);
    const real = places.realPathOf(next);
    if (real !== undefined) current = real;
    else if (places.isLink(next)) return undefined;
    else current = next;
  }
  return current;
}
