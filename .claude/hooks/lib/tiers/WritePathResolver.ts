// Resolves a path against the workspace and temp places, for ./stepWrites.ts's write rule and the `open` verdict.
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";

// realPathOf is undefined when nothing is there; isLink is true for a symlink, dangling or not.
export interface WritePlaces {
  workspaceRoot: string;
  tmpDir: string;
  realPathOf: (path: string) => string | undefined;
  isLink: (path: string) => boolean;
  // True for a regular file, symlinks followed, so `open` of a folder or app bundle isn't freed.
  isFile: (path: string) => boolean;
}

// Where a call runs, for resolving a relative path it writes or opens.
export interface ShellPlaces extends WritePlaces {
  cwd: string;
}

// On a one-person machine the shared /tmp is as throwaway as $TMPDIR, which on macOS sits elsewhere.
const sharedTmpDir = "/tmp";

export class WritePathResolver {
  readonly places: WritePlaces;

  private constructor(places: WritePlaces) {
    this.places = places;
  }

  static init(places: WritePlaces): WritePathResolver {
    return new WritePathResolver(places);
  }

  // Walked a part at a time, so `..` follows a symlink as the kernel does; undefined through a dangling link.
  resolvedPathOf(path: string): string | undefined {
    let current = "/";
    for (const part of path.split("/")) {
      if (part === "" || part === ".") continue;
      if (part === "..") {
        current = dirname(current);
        continue;
      }
      const next = join(current, part);
      const real = this.places.realPathOf(next);
      if (real !== undefined) current = real;
      else if (this.places.isLink(next)) return undefined;
      else current = next;
    }
    return current;
  }

  resolvedFileInPlacesOf(path: string, cwd: string): string | undefined {
    const resolved = this.resolvedPathOf(resolve(cwd, path));
    if (resolved === undefined || !this.places.isFile(resolved)) {
      return undefined;
    }
    const isInside =
      this.partsInside(resolved, this.places.workspaceRoot) !== undefined ||
      this.tmpPartsOf(resolved) !== undefined;
    return isInside ? resolved : undefined;
  }

  // The path's parts below $TMPDIR or /tmp, or undefined when it is strictly inside neither or is in .git at any depth.
  tmpPartsOf(resolved: string): string[] | undefined {
    return (
      this.partsClearOfGit(resolved, this.places.tmpDir) ??
      this.partsClearOfGit(resolved, sharedTmpDir)
    );
  }

  // The path's parts below a root, or undefined when it isn't strictly inside it or is in .git at any depth.
  partsClearOfGit(resolved: string, root: string): string[] | undefined {
    const parts = this.partsInside(resolved, root);
    return parts?.includes(".git") ? undefined : parts;
  }

  // The path's parts below a root, or undefined when it isn't strictly inside it.
  partsInside(resolved: string, root: string): string[] | undefined {
    const inside = relative(this.places.realPathOf(root) ?? root, resolved);
    if (inside === "" || isAbsolute(inside)) return undefined;
    if (inside === ".." || inside.startsWith(`..${sep}`)) return undefined;
    return inside.split(sep);
  }
}
