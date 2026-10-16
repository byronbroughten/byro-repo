// The claude session this command runs under, the holder of the session workspace's lease.
import { execFileSync } from "node:child_process";
import { basename } from "node:path";

import type { LeaseHolder } from "@byronbroughten/spec-runner/IssueWorkspaces";

export function nearestClaudeAncestor(): LeaseHolder | undefined {
  let pid = process.ppid;
  while (pid > 1) {
    const [parent, ...command] = processLineOf(pid).split(/\s+/);
    if (basename(command.join(" ")) === "claude") {
      return { kind: "session", pid };
    }
    pid = Number(parent);
  }
  return undefined;
}

// Empty once the process has exited, which ends the walk.
function processLineOf(pid: number): string {
  try {
    return execFileSync("ps", ["-o", "ppid=,comm=", "-p", String(pid)], {
      encoding: "utf8",
    }).trim();
  } catch {
    return "";
  }
}
