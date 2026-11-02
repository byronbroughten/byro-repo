// Deletes a landing's branches on each remote and locally, recording the ones that failed.

import { messageOf } from "../failureText.ts";
import { git, hasRef } from "../git.ts";
import { WrapUpBase } from "./WrapUpBase.ts";
import { type Landing } from "./wrapUpTypes.ts";

export class BranchDeleter extends WrapUpBase {
  async _deleteBranches(landing: Landing): Promise<void> {
    const failures: string[] = [];
    for (const { repo, branch } of await landing.kind.branchesToDelete(
      landing,
    )) {
      try {
        await this._deleteBranch(repo, branch);
      } catch (error) {
        const failure = `${repo} ${branch}: ${messageOf(error)}`;
        this._log(`Branch delete failed, continuing: ${failure}`);
        failures.push(failure);
      }
    }
    landing.progress.branchDeleteFailures = failures;
  }

  private async _deleteBranch(repo: string, branch: string): Promise<void> {
    const primary = this._primaryOf(repo);
    const remote = await this._withRetries(`Reading ${repo}'s remote`, () =>
      git(primary, "ls-remote", "--heads", "origin", branch),
    );
    if (remote !== "") {
      await this._withRetries(`Deleting ${branch} on ${repo}'s remote`, () =>
        git(primary, "push", "origin", "--delete", branch),
      );
    }
    if (await hasRef(primary, `refs/heads/${branch}`)) {
      await git(primary, "branch", "-d", branch);
    }
  }
}
