// Runs one knob Command to its end, for SpecRun/PreflightChecker.ts and SpecRun/TicketLander/TicketChecker.ts; the failure wording is failureText.ts.
import { execFile } from "node:child_process";
import { promisify } from "node:util";

import { messageOf, outputTailOf } from "./failureText.ts";
import type { Command } from "./runKnobs.ts";

const execFileAsync = promisify(execFile);

// The command's output tail when it fails, undefined when it passes.
export async function runCommand(
  command: Command,
  cwd: string,
): Promise<string | undefined> {
  const [file, ...args] = command;
  try {
    await execFileAsync(file, args, { cwd, maxBuffer: 64 * 1024 * 1024 });
    return undefined;
  } catch (error) {
    return outputTailOf(error) || messageOf(error);
  }
}
