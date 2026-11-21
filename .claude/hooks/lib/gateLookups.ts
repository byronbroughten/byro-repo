// The file-system lookups the tier gate's Bash decision reads, shared by tierGate.ts and stepPermission.ts so both decide a call alike.
import { lstatSync, realpathSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { primaryRootOf } from "./branchRecords.ts";
import {
  type HookInput,
  isObject,
  projectDirOf,
  readJsonFile,
  sessionStatePath,
} from "./hookIo.ts";
import { type HeldSends, heldSends } from "./tiers/tiers/heldSends.ts";
import type { ShellPlaces } from "./tiers/WritePathResolver.ts";

const dryRunSuffix = "chore-dry-runs.json";

export function shellPlacesOf(input: HookInput): ShellPlaces {
  const workspaceRoot = projectDirOf(input);
  return {
    workspaceRoot,
    tmpDir: tmpdir(),
    cwd: input.cwd ?? workspaceRoot,
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
    isFile: (path) => {
      try {
        return statSync(path).isFile();
      } catch {
        return false;
      }
    },
  };
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

// The primary's file, whichever root the session started in: a workspace has no copy, and a runner step may write its own workspace's.
export const heldSendsSetting = {
  read(projectDir: string): HeldSends {
    const primaryRoot = primaryRootOf(projectDir);
    if (primaryRoot === undefined) return "confirm";
    return heldSendsSetting.at(primaryRoot);
  },
  // A missing or malformed file holds the send.
  at(primaryRoot: string): HeldSends {
    const settings = readJsonFile(
      join(primaryRoot, ".claude", "settings.local.json"),
    );
    const env = isObject(settings) ? settings.env : undefined;
    return heldSends.valueOf(
      isObject(env) ? env[heldSends.settingKey] : undefined,
    );
  },
};
