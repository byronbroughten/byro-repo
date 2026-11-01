// The one-turn headless session SessionProbe.ts and SandboxProbe.ts both launch.
import { spawn } from "node:child_process";

export interface HeadlessRun {
  exitCode: number | null;
  stdout: string;
  stderr: string;
}

// Each probe's session needs no recall afterwards and no more model than following one prompt.
const headlessArgs = ["--model", "haiku", "--no-session-persistence"] as const;

export async function runHeadless(
  claudePath: string,
  cwd: string,
  args: string[],
): Promise<HeadlessRun> {
  const child = spawn(claudePath, [...args, ...headlessArgs], {
    cwd,
    stdio: ["ignore", "pipe", "pipe"],
  });
  let stdout = "";
  let stderr = "";
  child.stdout.on("data", (chunk) => (stdout += chunk));
  child.stderr.on("data", (chunk) => (stderr += chunk));
  const exitCode = await new Promise<number | null>((resolve, reject) => {
    child.on("error", reject);
    child.on("close", resolve);
  });
  return { exitCode, stdout, stderr };
}
