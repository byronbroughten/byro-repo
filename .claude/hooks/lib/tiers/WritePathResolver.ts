// Resolves a write's path against the places a runner step may write, for ./stepWrites.ts's rule.
import { dirname, isAbsolute, join, relative, sep } from "node:path";

// realPathOf is undefined when nothing is there; isLink is true for a symlink, dangling or not.
export interface WritePlaces {
  workspaceRoot: string;
  tmpDir: string;
  realPathOf: (path: string) => string | undefined;
  isLink: (path: string) => boolean;
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
