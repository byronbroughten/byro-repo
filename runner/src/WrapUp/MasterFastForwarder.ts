// Fast-forwards each primary checkout's master to its built commit under the landing locks, installs any dependencies that
// changes, then runs the after hook and pushes. It builds LandingPusher, whose scan and push run under the same locks.

import { messageOf } from "../failureText.ts";
import { git, revOf } from "../git.ts";
import { LandingLock } from "../LandingLock.ts";
import { WrapUpFailure } from "../WrapUpFailure.ts";
import { LandingPusher } from "./LandingPusher.ts";
import { WrapUpBase } from "./WrapUpBase.ts";
import {
  type BuiltRepo,
  installCommandLabel,
  type Landing,
} from "./wrapUpTypes.ts";

export class MasterFastForwarder extends WrapUpBase {
  private get pusher(): LandingPusher {
    return new LandingPusher(this.config);
  }

  // Locks are taken root first for every lander, so two landings never deadlock; the push runs under them too.
  async _fastForward(landing: Landing): Promise<boolean> {
    const built = landing.progress.built ?? {};
    const repos = this._rootFirst(Object.keys(built));
    const locks: LandingLock[] = [];
    try {
      for (const repo of repos) {
        locks.push(
          await LandingLock.acquire(
            await absoluteGitDirOf(this._primaryOf(repo)),
            { pollMs: this.knobs.lockPollMs, sleep: this._sleep },
          ),
        );
      }
      for (const repo of repos) {
        await this._assertOnMaster(repo);
        const master = await revOf(this._primaryOf(repo), "master");
        const { base, head } = built[repo] as BuiltRepo;
        if (master !== base && master !== head) return false;
      }
      for (const repo of repos) {
        await this._fastForwardRepo(repo, built[repo] as BuiltRepo);
      }
      await this._markDone(landing, "fast-forward");
      await this._installChangedDependencies(built);
      await this._runAfterFastForward();
      await this.pusher._scanAndPush(landing);
      return true;
    } finally {
      locks.forEach((lock) => lock.release());
    }
  }

  private _rootFirst(repos: string[]): string[] {
    return [...repos].sort(
      (a, b) => this._clonePathOf(a).length - this._clonePathOf(b).length,
    );
  }

  private async _installChangedDependencies(
    built: Record<string, BuiltRepo>,
  ): Promise<void> {
    const { primaryRoot } = this.config.workspaces;
    try {
      await this._installIfDependenciesChanged(
        primaryRoot,
        Object.entries(built).map(([repo, { base, head }]) => ({
          clone: this._primaryOf(repo),
          from: base,
          to: head,
        })),
      );
    } catch (error) {
      this._log(
        `Warning: continuing without the dependency install; run ${installCommandLabel} in the primary root before the next check: ${messageOf(error)}`,
      );
    }
  }

  private async _runAfterFastForward(): Promise<void> {
    try {
      await this.config.afterFastForward?.(this.config.workspaces.primaryRoot);
    } catch (error) {
      this._log(
        `Warning: the after-fast-forward hook failed, continuing: ${messageOf(error)}`,
      );
    }
  }

  private async _fastForwardRepo(
    repo: string,
    { head }: BuiltRepo,
  ): Promise<void> {
    const primary = this._primaryOf(repo);
    if ((await revOf(primary, "master")) === head) return;
    try {
      await git(primary, "merge", "--ff-only", head);
    } catch (error) {
      throw new WrapUpFailure(
        "dirty-tree",
        `Fast-forwarding ${repo}'s primary checkout failed, likely over its uncommitted changes: ${messageOf(error)}`,
      );
    }
  }
}

async function absoluteGitDirOf(clone: string): Promise<string> {
  return git(clone, "rev-parse", "--absolute-git-dir");
}
