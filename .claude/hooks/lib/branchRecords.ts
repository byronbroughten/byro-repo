// The branch guard's I/O: finds the primary checkouts, reads their branches and HEADs, and stores one record per session. The decisions are in branchGuard.ts.
import { spawnSync } from "node:child_process";
import { existsSync, readdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

import type { CheckoutStates, SessionRecord } from "./branchGuard.ts";
import { readJsonFile, sessionStatePath } from "./hookIo.ts";

const recordSuffix = "branch-record.json";

// The root's primary checkout, found through the git common dir so a session in an issue workspace still finds it.
export function primaryRootOf(projectDir: string): string | undefined {
  const commonDir = gitOutput(projectDir, [
    "rev-parse",
    "--path-format=absolute",
    "--git-common-dir",
  ]);
  return commonDir === undefined ? undefined : dirname(commonDir);
}

// The root plus each package clone under it.
export function primaryCheckoutsOf(primaryRoot: string): string[] {
  const packagesDir = join(primaryRoot, "packages");
  if (!existsSync(packagesDir)) return [primaryRoot];
  const clones = readdirSync(packagesDir)
    .map((name) => join(packagesDir, name))
    .filter((path) => existsSync(join(path, ".git")));
  return [primaryRoot, ...clones];
}

export function checkoutStatesOf(checkouts: string[]): CheckoutStates {
  return checkouts.reduce<CheckoutStates>((states, checkout) => {
    const head = gitOutput(checkout, ["rev-parse", "HEAD"]);
    if (head !== undefined) {
      states[checkout] = {
        branch: gitOutput(checkout, ["symbolic-ref", "--short", "-q", "HEAD"]),
        head,
      };
    }
    return states;
  }, {});
}

export function readRecord(sessionId: string): SessionRecord | undefined {
  return parseRecord(recordPathOf(sessionId));
}

export function writeRecord(record: SessionRecord): void {
  writeFileSync(recordPathOf(record.sessionId), JSON.stringify(record));
}

function recordPathOf(sessionId: string): string {
  return sessionStatePath(sessionId, recordSuffix);
}

function parseRecord(path: string): SessionRecord | undefined {
  const record = readJsonFile(path) as Partial<SessionRecord> | undefined;
  return record &&
    typeof record === "object" &&
    typeof record.sessionId === "string"
    ? (record as SessionRecord)
    : undefined;
}

function gitOutput(cwd: string, args: string[]): string | undefined {
  const { status, stdout } = spawnSync("git", args, { cwd, encoding: "utf8" });
  if (status !== 0) return undefined;
  return stdout.trim() || undefined;
}
