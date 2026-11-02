// A workspace key as the arguments every issue:* command and /start-issue take.
import type { WorkspaceKey } from "@byronbroughten/spec-runner/IssueWorkspaces";

export function keyArgsOf(key: WorkspaceKey): string {
  if ("session" in key) return `--session ${key.session}`;
  return `${key.repo} ${key.number}`;
}
