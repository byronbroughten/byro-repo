// What a thrown error or a failed command says, worded once for SpecRun.ts and WrapUp.ts.

import { lines } from "./git.ts";

const outputTailLines = 40;

export function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

// The last lines of a failed execFile's stdout and stderr.
export function outputTailOf(error: unknown): string {
  const { stdout = "", stderr = "" } = error as {
    stdout?: string;
    stderr?: string;
  };
  return lines(`${stdout}\n${stderr}`.trim())
    .slice(-outputTailLines)
    .join("\n");
}
