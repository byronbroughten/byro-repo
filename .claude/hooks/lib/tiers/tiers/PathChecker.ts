// The paths a call names, checked against the places it runs in: the write rule, scratch `node` files, `cd` targets and the step's own checkout.
import { isAbsolute } from "node:path";

import {
  isStepWritable,
  partsClearOfGit,
  partsInside,
  resolvedPathOf,
  tmpPartsOf,
} from "../stepWrites.ts";
import type { ShellPlaces, Verdict } from "../tiers.ts";

export class PathChecker {
  // Absent, no write passes the write rule and no `node` file is scratch.
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

  // The ask for the first path that fails the write rule, or undefined when every one passes.
  writeAskAmong(paths: string[]): Verdict | undefined {
    const blockedPath = paths.find((path) => !this.isWritable(path));
    if (blockedPath === undefined) return undefined;
    return {
      permissionDecision: "ask",
      why: `writes \`${blockedPath}\`, which isn't ${writablePlaces}, or is in \`.git\``,
    };
  }

  // An existing file gitignored inside the workspace but outside node_modules, or anywhere in $TMPDIR or /tmp outside .git.
  isScratchFile(written: string): boolean {
    const { places } = this;
    if (!places) return false;
    const path = tmpDirExpanded(written, places);
    if (!isPlainPath(path)) return false;
    const resolved = resolvedPathOf(absoluteOf(path, places.cwd), places);
    if (resolved === undefined || places.realPathOf(resolved) === undefined) {
      return false;
    }
    const workspaceParts = partsInside(resolved, places.workspaceRoot, places);
    if (workspaceParts) {
      return (
        !workspaceParts.includes(installedPackages) &&
        places.isIgnored(resolved)
      );
    }
    return tmpPartsOf(resolved, places) !== undefined;
  }

  isWritable(written: string): boolean {
    const { places } = this;
    if (!places) return false;
    const path = tmpDirExpanded(written, places);
    if (!isPlainPath(path)) return false;
    return isStepWritable(absoluteOf(path, places.cwd), places);
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

// The step write rule's places, as every write verdict names them.
export const writablePlaces = "inside the workspace, `$TMPDIR` or `/tmp`";

// Gitignored, but an installed package's bin is a tool such as clasp, not a scratch helper.
const installedPackages = "node_modules";

// No expansion the gate can't follow: a variable, a glob, braces or `~`.
function isPlainPath(path: string): boolean {
  return path !== "" && !path.startsWith("~") && !/[$`*?[\]{}]/.test(path);
}

// Joined, not resolved, so the write rule walks each `..` through any symlink.
function absoluteOf(path: string, cwd: string): string {
  return isAbsolute(path) ? path : `${cwd}/${path}`;
}

// A leading `$TMPDIR` or `${TMPDIR}` is the one variable the gate can follow, since it knows the value.
function tmpDirExpanded(path: string, places: ShellPlaces): string {
  return path.replace(/^(?:\$TMPDIR|\$\{TMPDIR\})(?=\/|$)/, places.tmpDir);
}
