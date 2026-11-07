// Scans the lines a landing adds to each master for token shapes, then pushes each master; a hit pushes nothing.

import { WrapUpBase } from "./WrapUpBase.ts";
import { type Landing } from "./wrapUpTypes.ts";

export class LandingPusher extends WrapUpBase {
  // A refusal leaves secret-scan undone, so a rerun rescans.
  async _scanAndPush(landing: Landing): Promise<void> {
    await this._step(landing, "secret-scan", () =>
      this._scanForSecrets(
        "The landed master",
        builtReposOf(landing).map((repo) => ({
          repo,
          clone: this._primaryOf(repo),
          range: "origin/master...master",
        })),
      ),
    );
    await this._step(landing, "push", () => this._push(landing));
  }

  private async _push(landing: Landing): Promise<void> {
    for (const repo of builtReposOf(landing)) {
      await this._pushToOrigin({
        label: `Pushing ${repo}'s master`,
        clone: this._primaryOf(repo),
        branch: "master",
        flags: [],
      });
    }
  }
}

function builtReposOf(landing: Landing): string[] {
  return Object.keys(landing.progress.built ?? {});
}
