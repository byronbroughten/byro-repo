// The .claude/ entries Claude Code's sandbox write-protects in a worktree, and the check that a removal can delete them.

import { lstatSync, renameSync } from "node:fs";
import { join } from "node:path";

import { callOfItsOwn } from "../callOfItsOwn.ts";

// Protected in every worktree, whatever the settings say.
export const protectedClaudeEntries = [
  "settings.json",
  "settings.local.json",
  "skills",
  "hooks",
  ".cc-writes",
];

interface DeletableCheck {
  path: string;
  clonePaths: string[];
  removeCommand: string;
}

// A git worktree remove stopped by one has already deleted the rest of the folder and dropped git's record of it.
export function assertClaudeEntriesDeletable({
  path,
  clonePaths,
  removeCommand,
}: DeletableCheck): void {
  clonePaths
    .flatMap((clonePath) =>
      protectedClaudeEntries.map((entry) =>
        join(path, clonePath, ".claude", entry),
      ),
    )
    .filter((entry) => lstatSync(entry, { throwIfNoEntry: false }))
    .forEach((entry) => assertDeletable(entry, removeCommand));
}

// A rename within its folder needs the same permission as the delete, and is undone at once.
// The pid keeps a check a crash left behind from blocking the next one.
function assertDeletable(entry: string, removeCommand: string): void {
  const moved = `${entry}.remove-check-${process.pid}`;
  try {
    renameSync(entry, moved);
  } catch (error) {
    throw new Error(
      `Can't delete ${entry}, since the sandbox can't delete a worktree's .claude/ files; nothing was removed, so ${callOfItsOwn(`run ${removeCommand}`)}`,
      { cause: error },
    );
  }
  renameSync(moved, entry);
}
