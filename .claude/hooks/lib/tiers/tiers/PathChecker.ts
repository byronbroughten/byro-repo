// The paths a call names, checked against the places it runs in: `cd` targets and the step's own checkout.
import { isAbsolute } from "node:path";

import { partsClearOfGit, resolvedPathOf } from "../stepWrites.ts";
import type { ShellPlaces } from "../tiers.ts";

export class PathChecker {
  // Absent, no `cd` target is followed and the cwd is in no checkout.
  readonly places: ShellPlaces | undefined;

  private constructor(places: ShellPlaces | undefined) {
    this.places = places;
  }

  static init(places: ShellPlaces | undefined): PathChecker {
    return new PathChecker(places);
  }

  cdTargetOf(target: string | undefined): string | undefined {
    // A flag such as `-P` or `--` would be taken for the target.
    if (!this.places || target === undefined || target.startsWith("-")) {
      return undefined;
    }
    const path = tmpDirExpanded(target, this.places);
    return isPlainPath(path) ? absoluteOf(path, this.places.cwd) : undefined;
  }

  // The workspace root, or a folder under it that no nested `.git` holds.
  get isCwdInWorkspaceCheckout(): boolean {
    const { places } = this;
    if (!places) return false;
    const cwd = resolvedPathOf(places.cwd, places);
    if (cwd === undefined) return false;
    if (
      cwd === (places.realPathOf(places.workspaceRoot) ?? places.workspaceRoot)
    ) {
      return true;
    }
    return partsClearOfGit(cwd, places.workspaceRoot, places) !== undefined;
  }
}

// No expansion the gate can't follow: a variable, a glob, braces or `~`.
function isPlainPath(path: string): boolean {
  return path !== "" && !path.startsWith("~") && !/[$`*?[\]{}]/.test(path);
}

// Joined, not resolved, so a later check walks each `..` through any symlink.
function absoluteOf(path: string, cwd: string): string {
  return isAbsolute(path) ? path : `${cwd}/${path}`;
}

// A leading `$TMPDIR` or `${TMPDIR}` is the one variable the gate can follow, since it knows the value.
function tmpDirExpanded(path: string, places: ShellPlaces): string {
  return path.replace(/^(?:\$TMPDIR|\$\{TMPDIR\})(?=\/|$)/, places.tmpDir);
}
