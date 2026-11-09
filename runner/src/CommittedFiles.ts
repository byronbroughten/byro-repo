// A set of committed files in one repo, for a check stamp's key (Checks.ts): a folder's paths less some excluded folders,
// read from HEAD, and whether any of them has an uncommitted or untracked change.
import { createHash } from "node:crypto";

import { git, hasChangesAt } from "./git.ts";

export interface FilesSpec {
  folder: string;
  includedPaths: string[];
  // Relative to folder.
  excludedPaths: string[];
}

// A digest of the files' HEAD listing, and whether any has a change no stamp could describe.
export interface FilesState {
  digest: string;
  isDirty: boolean;
}

export class CommittedFiles {
  private readonly spec: FilesSpec;

  constructor(spec: FilesSpec) {
    this.spec = spec;
  }

  static init(spec: FilesSpec): CommittedFiles {
    return new CommittedFiles(spec);
  }

  async state(): Promise<FilesState> {
    if (this.spec.includedPaths.length === 0) {
      return { digest: "", isDirty: false };
    }
    const [listing, isDirty] = await Promise.all([
      this._listing(),
      this._hasChanges(),
    ]);
    return {
      digest: createHash("sha256").update(listing).digest("hex"),
      isDirty,
    };
  }

  // ls-tree takes no exclude pathspec, so the excluded folders are filtered out of its listing here.
  private async _listing(): Promise<string> {
    const { folder, includedPaths, excludedPaths } = this.spec;
    const listing = await git(
      folder,
      "ls-tree",
      "-r",
      "-z",
      "HEAD",
      "--",
      ...includedPaths,
    );
    return listing
      .split("\0")
      .filter((entry) => {
        if (entry === "") return false;
        const path = entry.slice(entry.indexOf("\t") + 1);
        return !excludedPaths.some(
          (excluded) => path === excluded || path.startsWith(`${excluded}/`),
        );
      })
      .join("\n");
  }

  private _hasChanges(): Promise<boolean> {
    const { folder, includedPaths, excludedPaths } = this.spec;
    return hasChangesAt(folder, [
      ...includedPaths,
      ...excludedPaths.map((path) => `:(exclude)${path}`),
    ]);
  }
}
