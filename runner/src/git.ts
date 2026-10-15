// The git helpers IssueWorkspaces.ts and WrapUp.ts share.

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

export function lines(output: string): string[] {
  return output === "" ? [] : output.split("\n");
}
