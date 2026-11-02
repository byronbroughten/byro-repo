// Scans the lines a landing adds to each master for token shapes, then pushes each master; a hit pushes nothing.

import { git, lines } from "../git.ts";
import { secretShapeOf } from "../secretShapes.ts";
import { WrapUpFailure } from "../WrapUpFailure.ts";
import { WrapUpBase } from "./WrapUpBase.ts";
import { type Landing } from "./wrapUpTypes.ts";

interface AddedLine {
  file: string;
  line: number;
  text: string;
}

export class LandingPusher extends WrapUpBase {
  // A refusal leaves secret-scan undone, so a rerun rescans.
  async _scanAndPush(landing: Landing): Promise<void> {
    await this._step(landing, "secret-scan", () =>
      this._scanForSecrets(landing),
    );
    await this._step(landing, "push", () => this._push(landing));
  }

  private async _scanForSecrets(landing: Landing): Promise<void> {
    const hits: string[] = [];
    for (const repo of Object.keys(landing.progress.built ?? {})) {
      const diff = await git(
        this._primaryOf(repo),
        "-c",
        "core.quotePath=false",
        "diff",
        "-U0",
        "--no-color",
        "--no-ext-diff",
        "origin/master...master",
      );
      addedLinesOf(diff).forEach(({ file, line, text }) => {
        const shape = secretShapeOf(text);
        if (shape !== undefined) {
          hits.push(`${repo} ${file}:${line} (${shape})`);
        }
      });
    }
    if (hits.length === 0) return;
    throw new WrapUpFailure(
      "secret-scan",
      `The landed master adds token-shaped lines, so nothing was pushed:\n${hits.join("\n")}`,
    );
  }

  private async _push(landing: Landing): Promise<void> {
    for (const repo of Object.keys(landing.progress.built ?? {})) {
      await this._withRetries(`Pushing ${repo}'s master`, () =>
        git(this._primaryOf(repo), "push", "origin", "master"),
      );
    }
  }
}

// Each line a unified diff adds, with its file and line number in the new version.
function addedLinesOf(diff: string): AddedLine[] {
  const added: AddedLine[] = [];
  let file = "";
  let line = 0;
  let isInHunk = false;
  lines(diff).forEach((diffLine) => {
    if (diffLine.startsWith("diff --git ")) {
      isInHunk = false;
    } else if (!isInHunk && diffLine.startsWith("+++ ")) {
      file = diffLine.slice(4).replace(/^"?b\/(.*?)"?$/, "$1");
    } else if (diffLine.startsWith("@@")) {
      isInHunk = true;
      line = Number(/\+(\d+)/.exec(diffLine)?.[1] ?? 0);
    } else if (isInHunk && diffLine.startsWith("+")) {
      added.push({ file, line, text: diffLine.slice(1) });
      line += 1;
    }
  });
  return added;
}
