// `npm run ws:rm`'s core: deletes tracked files in a Workspace through `git rm`, or nothing when any path is refused. wsRm.ts does the I/O.
// It runs outside the sandbox, which protects a worktree's .claude/hooks and .claude/skills, so every path is checked before any delete.
import { execFileSync } from "node:child_process";
import { existsSync, realpathSync } from "node:fs";
import {
  basename,
  dirname,
  isAbsolute,
  join,
  relative,
  resolve,
} from "node:path";

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

// A path git tracks in one of a Workspace's checkouts.
interface TrackedPath {
  path: string;
  checkout: string;
  checkoutPath: string;
}

const refusalWhys = {
  gitFolder: "is under a `.git` folder",
  primary: "is in a Primary checkout",
  outside: "is outside every Workspace",
  untracked: "isn't a file git tracks",
} as const;

export function workspaceRm(request: WorkspaceRmRequest): WorkspaceRmResult {
  const checked = request.paths.map((path) => trackedPathOf(path, request));
  const refused = checked.flatMap((check) => ("why" in check ? [check] : []));
  const tracked = checked.flatMap((check) => ("why" in check ? [] : [check]));
  const byCheckout = Map.groupBy(tracked, ({ checkout }) => checkout);
  // A dry run in every checkout first, so git's own refusal in one leaves the others untouched.
  byCheckout.forEach((paths, checkout) =>
    refused.push(...gitRefusalsOf(checkout, paths)),
  );
  if (refused.length > 0) return { removed: [], refused };
  byCheckout.forEach((paths, checkout) =>
    gitRm(
      checkout,
      paths.map(({ checkoutPath }) => checkoutPath),
    ),
  );
  return { removed: tracked.map(({ path }) => path), refused: [] };
}

function trackedPathOf(
  path: string,
  { cwd, primaryRoot, workspaceFolder }: WorkspaceRmRequest,
): TrackedPath | RefusedPath {
  const absolute = resolve(cwd, path);
  const real = realParentOf(absolute);
  if (isUnderGitFolder(path) || isUnderGitFolder(real)) {
    return { path, why: refusalWhys.gitFolder };
  }
  const workspaces = realParentOf(workspaceFolder);
  if (!isInside(real, workspaces)) {
    const why = isInside(real, realParentOf(primaryRoot))
      ? refusalWhys.primary
      : refusalWhys.outside;
    return { path, why };
  }
  const checkout = checkoutOf(dirname(real));
  if (checkout === undefined) return { path, why: refusalWhys.untracked };
  if (!isInside(real, checkout) || !isInside(checkout, workspaces)) {
    return { path, why: refusalWhys.primary };
  }
  const checkoutPath = relative(checkout, real);
  if (!trackedFilesOf(checkout, checkoutPath).includes(checkoutPath)) {
    return { path, why: refusalWhys.untracked };
  }
  return { path, checkout, checkoutPath };
}

// The parent folders through their symlinks, so a symlinked file is the link git tracks, never its target.
function realParentOf(path: string): string {
  if (existsSync(dirname(path))) {
    return join(realpathSync(dirname(path)), basename(path));
  }
  if (dirname(path) === path) return path;
  return join(realParentOf(dirname(path)), basename(path));
}

function isUnderGitFolder(path: string): boolean {
  return path.split(/[\\/]/).includes(".git");
}

// Strictly inside: the folder itself isn't a path in it.
function isInside(path: string, folder: string): boolean {
  const rest = relative(folder, path);
  return rest !== "" && !rest.startsWith("..") && !isAbsolute(rest);
}

function checkoutOf(folder: string): string | undefined {
  if (!existsSync(folder)) return undefined;
  try {
    return realpathSync(git(folder, ["rev-parse", "--show-toplevel"]).trim());
  } catch {
    return undefined;
  }
}

function trackedFilesOf(checkout: string, checkoutPath: string): string[] {
  return git(checkout, ["ls-files", "-z", "--", checkoutPath]).split("\0");
}

function gitRefusalsOf(checkout: string, paths: TrackedPath[]): RefusedPath[] {
  return paths.flatMap(({ path, checkoutPath }) => {
    try {
      git(checkout, ["rm", "-n", "-q", "--", checkoutPath]);
      return [];
    } catch (error) {
      return [{ path, why: `is refused by git rm: ${gitErrorOf(error)}` }];
    }
  });
}

function gitRm(checkout: string, checkoutPaths: string[]): void {
  git(checkout, ["rm", "-q", "--", ...checkoutPaths]);
}

function gitErrorOf(error: unknown): string {
  const stderr = (error as { stderr?: unknown }).stderr;
  const text = typeof stderr === "string" ? stderr : String(error);
  return text.trim().replace(/\s+/g, " ");
}

// Literal pathspecs, so a `*` or `:` in a name matches only that name.
function git(cwd: string, args: string[]): string {
  return execFileSync("git", ["--literal-pathspecs", ...args], {
    cwd,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });
}
