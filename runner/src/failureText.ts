// What a thrown error or a failed command says, worded once for SpecRun.ts, WrapUp.ts and Checks.ts.

import { lines } from "./git.ts";
import type { Command } from "./runKnobs.ts";

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
  return tailOf(`${stdout}\n${stderr}`);
}

export function tailOf(output: string): string {
  return lines(output.trim()).slice(-outputTailLines).join("\n");
}

export function commandLabelOf(command: Command): string {
  return command.join(" ");
}
