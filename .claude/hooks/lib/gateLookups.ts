// The file-system lookups the tier gate's Bash decision reads, shared by tierGate.ts and stepPermission.ts so both decide a call alike.
import { spawnSync } from "node:child_process";
import { lstatSync, realpathSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname } from "node:path";

import {
  type HookInput,
  projectDirOf,
  readJsonFile,
  sessionStatePath,
} from "./hookIo.ts";
import type { ShellPlaces } from "./tiers/tiers.ts";

const dryRunSuffix = "chore-dry-runs.json";

export function shellPlacesOf(input: HookInput): ShellPlaces {
  const workspaceRoot = projectDirOf(input);
  return shellPlacesAt(workspaceRoot, input.cwd ?? workspaceRoot);
}

// Also for a replay of a past call, whose session root and cwd come from its transcript.
export function shellPlacesAt(workspaceRoot: string, cwd: string): ShellPlaces {
  return {
    workspaceRoot,
    tmpDir: tmpdir(),
    cwd,
    realPathOf: (path) => {
      try {
        return realpathSync.native(path);
      } catch {
        return undefined;
      }
    },
    isLink: (path) => {
      try {
        return lstatSync(path).isSymbolicLink();
      } catch {
        return false;
      }
    },
    isIgnored: isGitIgnored,
  };
}

// Asked of the path's own checkout, since the root ignores each package clone whole.
function isGitIgnored(path: string): boolean {
  const checked = spawnSync("git", [
    "-C",
    dirname(path),
    "check-ignore",
    "-q",
    path,
  ]);
  return checked.status === 0;
}

export const dryRuns = {
  read(sessionId: string | undefined): string[] {
    const recorded = readJsonFile(sessionStatePath(sessionId, dryRunSuffix));
    return Array.isArray(recorded) ? recorded : [];
  },
  record(sessionId: string | undefined, chores: string[]): void {
    if (chores.length === 0) return;
    const recorded = new Set([...dryRuns.read(sessionId), ...chores]);
    writeFileSync(
      sessionStatePath(sessionId, dryRunSuffix),
      JSON.stringify([...recorded]),
    );
  },
};
