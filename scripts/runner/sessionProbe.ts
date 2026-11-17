// Starts a one-turn headless session in a folder and prints what its hooks see, $CLAUDE_PROJECT_DIR first.
// Usage: npm run session:probe -- <folder>, e.g. an issue workspace's path from npm run issue:list.
// Sandbox check: npm run session:probe -- --sandbox-check [--keep-excluded] <folder> <commands-file> runs each line of the file once under the folder's sandbox block and prints ran or stopped for each.
// Injection check: npm run session:probe -- --injection-check <folder> invokes throwaway skills holding an injected command under the folder's sandbox block and prints whether each ran, in the box or not, and what a PreToolUse hook saw.
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";

import {
  injectionOutcomeText,
  InjectionProbe,
} from "@byronbroughten/spec-runner/InjectionProbe";
import {
  commandOutcomeText,
  SandboxProbe,
  type SandboxReport,
} from "@byronbroughten/spec-runner/SandboxProbe";
import { SessionProbe } from "@byronbroughten/spec-runner/SessionProbe";

const usage = [
  "Usage: npm run session:probe -- <folder>",
  "       npm run session:probe -- --sandbox-check [--keep-excluded] <folder> <commands-file>",
  "       npm run session:probe -- --injection-check <folder>",
  "--sandbox-check runs every listed command for real, inside the box: list only reads, dry-run forms and writes into a throwaway repo in temp.",
  "--keep-excluded keeps the folder's excludedCommands, so a call Claude Code lets out runs outside the box: list only reads.",
  "--injection-check invokes throwaway skills in a folder under temp, by slash command and through the Skill tool, each with an injected `npm run` call of a brief script there that reads `ps` and writes what it saw beside it, under the folder's sandbox block.",
].join("\n");
const keepExcludedFlag = "--keep-excluded";

const reportPaths = {
  sandbox: ".probe/sandbox-last.json",
  injection: ".probe/injection-last.json",
} as const;

try {
  const args = process.argv.slice(2);
  if (args[0] === "--sandbox-check") {
    await probeSandbox(args.slice(1));
  } else if (args[0] === "--injection-check") {
    await probeInjection(args.slice(1));
  } else {
    await probeSession(args);
  }
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
}

async function probeSession([folder]: string[]): Promise<void> {
  if (folder === undefined) throw new Error(usage);
  const cwd = resolve(folder);
  const reading = await SessionProbe.init().run(cwd);
  const verdict = reading.projectDir === cwd ? "matches" : "differs from";
  console.log(
    `CLAUDE_PROJECT_DIR ${reading.projectDir} ${verdict} the folder.`,
  );
  console.log(JSON.stringify(reading, null, 2));
}

async function probeSandbox(args: string[]): Promise<void> {
  const keepsExcluded = args[0] === keepExcludedFlag;
  const [folder, commandsPath] = keepsExcluded ? args.slice(1) : args;
  if (folder === undefined || commandsPath === undefined) {
    throw new Error(usage);
  }
  const probe = SandboxProbe.init();
  let report: SandboxReport;
  if (keepsExcluded) {
    report = await probe.runKeepingExcluded(
      resolve(folder),
      resolve(commandsPath),
    );
  } else {
    report = await probe.run(resolve(folder), resolve(commandsPath));
  }
  writeReport(reportPaths.sandbox, report);
  for (const outcome of report.outcomes) {
    console.log(commandOutcomeText(outcome));
  }
  console.log(`Full output: ${reportPaths.sandbox}`);
}

async function probeInjection([folder]: string[]): Promise<void> {
  if (folder === undefined) throw new Error(usage);
  const report = await InjectionProbe.init().run(resolve(folder));
  writeReport(reportPaths.injection, report);
  for (const outcome of report.outcomes) {
    console.log(injectionOutcomeText(outcome));
  }
  console.log(`Full output: ${reportPaths.injection}`);
}

function writeReport(path: string, report: object): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, JSON.stringify(report, null, 2));
}
