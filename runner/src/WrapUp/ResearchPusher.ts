// Pushes a Workspace checkout's `research/*` branch to origin, behind the secret scan LandingPusher.ts runs before a
// landing's push (secretScan.ts). A `research/*` branch is never merged, so wrap-up never pushes it; this is its one
// way out.

import { realpathSync } from "node:fs";
import { join, relative, sep } from "node:path";

import { currentBranchOf, git, gitDirOf, hasRef } from "../git.ts";
import { nothingPushedAfter, scanForSecrets } from "../secretScan.ts";
import { WrapUpBase } from "./WrapUpBase.ts";

const researchPrefix = "research/";

export class ResearchPusher extends WrapUpBase {
  // Returns the branch it pushed.
  async push(checkout: string): Promise<string> {
    const clone = await git(checkout, "rev-parse", "--show-toplevel");
    const branch = currentBranchOf(clone);
    if (!branch.startsWith(researchPrefix) || branch === researchPrefix) {
      throw new Error(
        nothingPushedAfter(
          `${clone} is on ${branch || "a detached HEAD"}, not under \`${researchPrefix}\``,
        ),
      );
    }
    if (isPrimaryCheckout(clone)) {
      throw new Error(
        nothingPushedAfter(`${clone} is a primary checkout, not a Workspace's`),
      );
    }
    const repo = this._repoOf(clone);
    const base = (await hasRef(clone, `refs/remotes/origin/${branch}`))
      ? `origin/${branch}`
      : "origin/master";
    await scanForSecrets(`${branch} over ${base}`, [
      { repo, clone, range: `${base}...HEAD` },
    ]);
    await this._pushToOrigin({
      label: `Pushing ${repo}'s ${branch}`,
      clone,
      branch,
      setsUpstream: true,
    });
    return branch;
  }

  // The repo whose clone path the checkout sits at inside its Workspace's folder.
  private _repoOf(clone: string): string {
    const workspaceFolder = realpathSync(
      this.config.workspaces.workspaceFolder,
    );
    const [, ...clonePath] = relative(workspaceFolder, clone).split(sep);
    if (clonePath[0] === "..") {
      throw new Error(
        nothingPushedAfter(
          `${clone} isn't in a Workspace under ${workspaceFolder}`,
        ),
      );
    }
    const path = clonePath.join("/") || ".";
    const entry = Object.entries(this.config.workspaces.clonePaths).find(
      ([, repoPath]) => repoPath === path,
    );
    if (!entry) {
      throw new Error(
        nothingPushedAfter(`${clone} is no repo's clone in its Workspace`),
      );
    }
    return entry[0];
  }
}

// A Workspace's checkout is a linked worktree, whose `.git` is a file naming its git folder.
function isPrimaryCheckout(clone: string): boolean {
  return gitDirOf(clone) === join(clone, ".git");
}
