// The git helpers IssueWorkspaces.ts and WrapUp.ts share.

import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

export async function git(cwd: string, ...args: string[]): Promise<string> {
  const { stdout } = await execFileAsync("git", args, { cwd });
  return stdout.trim();
}

export function lines(output: string): string[] {
  return output === "" ? [] : output.split("\n");
}
