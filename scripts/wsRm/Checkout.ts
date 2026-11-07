// One git checkout `npm run ws:rm` deletes in: which files it tracks, what `git rm` would refuse, and the delete itself.
import { execFileSync } from "node:child_process";
import { existsSync, realpathSync } from "node:fs";

export class Checkout {
  readonly root: string;

  constructor(root: string) {
    this.root = root;
  }

  // The checkout holding a folder, undefined when it is in none.
  static of(folder: string): Checkout | undefined {
    if (!existsSync(folder)) return undefined;
    try {
      const top = git(folder, ["rev-parse", "--show-toplevel"]).trim();
      return new Checkout(realpathSync(top));
    } catch {
      return undefined;
    }
  }

  isTracking(checkoutPath: string): boolean {
    return git(this.root, ["ls-files", "-z", "--", checkoutPath])
      .split("\0")
      .includes(checkoutPath);
  }

  // git's reason for refusing to delete it, or undefined when it would.
  rmRefusalOf(checkoutPath: string): string | undefined {
    try {
      git(this.root, ["rm", "-n", "-q", "--", checkoutPath]);
      return undefined;
    } catch (error) {
      return gitErrorOf(error);
    }
  }

  rm(checkoutPaths: string[]): void {
    git(this.root, ["rm", "-q", "--", ...checkoutPaths]);
  }
}

// Literal pathspecs, so a `*` or `:` in a name matches only that name.
function git(cwd: string, args: string[]): string {
  return execFileSync("git", ["--literal-pathspecs", ...args], {
    cwd,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });
}

function gitErrorOf(error: unknown): string {
  const stderr = (error as { stderr?: unknown }).stderr;
  const text = typeof stderr === "string" ? stderr : String(error);
  return text.trim().replace(/\s+/g, " ");
}
