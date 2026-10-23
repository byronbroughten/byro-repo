// Runs one process to its end with stdout and stderr collected together, for Checks.ts and scripts/tsc/tsc.ts.
import { spawn, type SpawnOptions } from "node:child_process";

export interface CollectedRun {
  isOk: boolean;
  // The spawn error's message when the process never started.
  output: string;
}

export function runCollecting(
  file: string,
  args: string[],
  options: SpawnOptions,
): Promise<CollectedRun> {
  return new Promise((resolve) => {
    const child = spawn(file, args, { ...options, stdio: "pipe" });
    let output = "";
    child.stdout.on("data", (chunk) => (output += chunk));
    child.stderr.on("data", (chunk) => (output += chunk));
    child.on("error", (error) =>
      resolve({ isOk: false, output: error.message }),
    );
    child.on("close", (code) =>
      resolve({ isOk: code === 0, output: output.trim() }),
    );
  });
}
