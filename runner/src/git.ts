// The git helpers IssueWorkspaces.ts, WrapUp.ts and SpecRun.ts share.

import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

export async function git(cwd: string, ...args: string[]): Promise<string> {
  // A whole landing's diff can outgrow execFile's 1 MB default.
  const { stdout } = await execFileAsync("git", args, {
    cwd,
    maxBuffer: 64 * 1024 * 1024,
  });
  return stdout.trim();
}

// No optional locks, so a status read never holds index.lock against a commit running in that worktree.
export async function isDirty(worktree: string): Promise<boolean> {
  return (
    (await git(worktree, "--no-optional-locks", "status", "--porcelain")) !== ""
  );
}

export function lines(output: string): string[] {
  return output === "" ? [] : output.split("\n");
}
