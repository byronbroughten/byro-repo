// A process's start time, which a lease or supervision record keeps so a reused process ID never makes an abandoned one look live.
import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

export async function startTimeOf(pid: number): Promise<string | undefined> {
  try {
    const { stdout } = await execFileAsync("ps", [
      "-o",
      "lstart=",
      "-p",
      `${pid}`,
    ]);
    return stdout.trim() || undefined;
  } catch {
    return undefined;
  }
}
