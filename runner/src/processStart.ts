// A process's start time, which a lease or supervision record keeps so a reused process ID never makes an abandoned one look live.
import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

// A process named by its pid and start time, as a lease file, a supervision record and its watch each record one.
export interface ProcessIdentity {
  pid: number;
  startedAt?: string;
}

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

export async function identityOf(pid: number): Promise<ProcessIdentity> {
  return { pid, startedAt: await startTimeOf(pid) };
}

// A process with no start time has exited, so it never matches even a record that saved none.
export async function isRunning({
  pid,
  startedAt,
}: ProcessIdentity): Promise<boolean> {
  const startedNow = await startTimeOf(pid);
  return startedNow !== undefined && startedNow === startedAt;
}

export function isSameProcess(a: ProcessIdentity, b: ProcessIdentity): boolean {
  return a.pid === b.pid && a.startedAt === b.startedAt;
}
