// `npm run ws:rm`'s core: deletes tracked files in a Workspace through `git rm`, or nothing when any path is refused. wsRm.ts does the I/O.
// It runs outside the sandbox, which protects a worktree's .claude/hooks and .claude/skills, so every path is checked before any delete.
import { existsSync, realpathSync } from "node:fs";
import {
  basename,
  dirname,
  isAbsolute,
  join,
  relative,
  resolve,
} from "node:path";

import { Checkout } from "./Checkout.ts";

export interface WorkspaceRmRequest {
  paths: string[];
  cwd: string;
  primaryRoot: string;
  workspaceFolder: string;
}

export interface RefusedPath {
  path: string;
  why: string;
}

export interface WorkspaceRmResult {
  removed: string[];
  refused: RefusedPath[];
}

interface TrackedPath {
  path: string;
  checkout: Checkout;
  checkoutPath: string;
}

interface CheckedPaths {
  tracked: TrackedPath[];
  refused: RefusedPath[];
}

interface Containment {
  path: string;
  folder: string;
}

const refusalWhys = {
  gitFolder: "is under a `.git` folder",
  primary: "is in a Primary checkout",
  outside: "is outside every Workspace",
  untracked: "isn't a file git tracks",
  gitRefused: (reason: string) => `is refused by git rm: ${reason}`,
} as const;

const realPaths = {
  // The parent folders through their symlinks, so a symlinked file is the link git tracks, never its target.
  parentOf(path: string): string {
    if (existsSync(dirname(path))) {
      return join(realpathSync(dirname(path)), basename(path));
    }
    if (dirname(path) === path) return path;
    return join(realPaths.parentOf(dirname(path)), basename(path));
  },
  isUnderGitFolder(path: string): boolean {
    return path.split(/[\\/]/).includes(".git");
  },
  // Strictly inside: the folder itself isn't a path in it.
  isInside({ path, folder }: Containment): boolean {
    const rest = relative(folder, path);
    return rest !== "" && !rest.startsWith("..") && !isAbsolute(rest);
  },
};

export function workspaceRm(request: WorkspaceRmRequest): WorkspaceRmResult {
  const { tracked, refused } = request.paths.reduce<CheckedPaths>(
    (checked, path) => {
      const check = trackedPathOf(path, request);
      if ("why" in check) checked.refused.push(check);
      else checked.tracked.push(check);
      return checked;
    },
    { tracked: [], refused: [] },
  );
  // A dry run of every path first, so git's own refusal in one checkout leaves the others untouched.
  const allRefused = [...refused, ...tracked.flatMap(gitRefusalsOf)];
  if (allRefused.length > 0) return { removed: [], refused: allRefused };
  Map.groupBy(tracked, ({ checkout }) => checkout.root).forEach((paths) =>
    paths[0]?.checkout.rm(paths.map(({ checkoutPath }) => checkoutPath)),
  );
  return { removed: tracked.map(({ path }) => path), refused: [] };
}

function trackedPathOf(
  path: string,
  { cwd, primaryRoot, workspaceFolder }: WorkspaceRmRequest,
): TrackedPath | RefusedPath {
  const real = realPaths.parentOf(resolve(cwd, path));
  if (realPaths.isUnderGitFolder(path) || realPaths.isUnderGitFolder(real)) {
    return { path, why: refusalWhys.gitFolder };
  }
  const workspaces = realPaths.parentOf(workspaceFolder);
  if (!realPaths.isInside({ path: real, folder: workspaces })) {
    const primary = realPaths.parentOf(primaryRoot);
    const why = realPaths.isInside({ path: real, folder: primary })
      ? refusalWhys.primary
      : refusalWhys.outside;
    return { path, why };
  }
  // A Workspace's root, or anything else beside it in the workspaces folder, sits in no checkout of a Workspace.
  const checkout = Checkout.of(dirname(real));
  if (
    checkout === undefined ||
    !realPaths.isInside({ path: real, folder: checkout.root }) ||
    !realPaths.isInside({ path: checkout.root, folder: workspaces })
  ) {
    return { path, why: refusalWhys.untracked };
  }
  const checkoutPath = relative(checkout.root, real);
  if (!checkout.isTracking(checkoutPath)) {
    return { path, why: refusalWhys.untracked };
  }
  return { path, checkout, checkoutPath };
}

function gitRefusalsOf({
  path,
  checkout,
  checkoutPath,
}: TrackedPath): RefusedPath[] {
  const reason = checkout.rmRefusalOf(checkoutPath);
  return reason === undefined
    ? []
    : [{ path, why: refusalWhys.gitRefused(reason) }];
}
