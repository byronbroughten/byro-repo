// Starts a one-turn headless session in a folder and prints what its hooks see, $CLAUDE_PROJECT_DIR first.
// Usage: npm run session:probe -- <folder>, e.g. an issue workspace's path from npm run issue:list.
// Sandbox check: npm run session:probe -- --sandbox-check [--keep-excluded] <folder> <commands-file> runs each line of the file once under the folder's sandbox block and prints ran or stopped for each.
// Injection check: npm run session:probe -- --injection-check <folder>; the usage text below describes it.
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";

import { injectionOutcomeText } from "@byronbroughten/spec-runner/injectionOutcomeText";
import { InjectionProbe } from "@byronbroughten/spec-runner/InjectionProbe";
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
  "--injection-check writes four throwaway skills to a folder under temp, each injecting `npm run brief -- <name> ${CLAUDE_SESSION_ID}` of a brief script there: one with no `allowed-tools` and one each with `Bash(npm run brief *)`, `Bash(npm run brief:*)` and `Bash`. The brief records `ps -p 1`, `TMPDIR`, anything session-like it got, and whether it can list and write a throwaway marker in `claude-guardrails/` under the `tmpdir()` the hooks log, and writes what it saw beside it. Each skill runs once by slash command and once through the Skill tool, each in its own one-turn headless session in that folder, with only project settings, the Bash and Skill tools, no permission prompts, the `<folder>`'s `sandbox` block as it is but for `allowUnsandboxedCommands` forced off, a `Skill` allow rule and a SessionStart and PreToolUse hook on every tool that logs what it sees, its session ID and `tmpdir()` included. One more run calls the `Bash(npm run brief *)` skill through the Skill tool with no `Skill` allow rule, to see whether that call is denied. Two more allow only `Skill(inject-npm-colon)`, with no other `Skill` rule, and call that skill and then the `Bash(npm run brief *)` skill through the Skill tool, to see whether the rule runs the skill it names and denies the other. It prints, for each run, whether a Skill call ran or failed, with its error, whether the brief ran, its `ps` result (which shows the box), whether it saw the hooks' session ID, the hook's `tmpdir()`, what the brief could do in `claude-guardrails/`, and what the PreToolUse hook saw; it writes the whole run to `.probe/injection-last.json` and deletes the folder.",
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
  printReport({
    path: reportPaths.sandbox,
    report,
    lines: report.outcomes.map(commandOutcomeText),
  });
}

async function probeInjection([folder]: string[]): Promise<void> {
  if (folder === undefined) throw new Error(usage);
  const report = await InjectionProbe.init().run(resolve(folder));
  printReport({
    path: reportPaths.injection,
    report,
    lines: report.outcomes.map(injectionOutcomeText),
  });
}

// Writes the whole report under .probe/ and prints one line per outcome and where the report went.
function printReport({
  path,
  report,
  lines,
}: {
  path: string;
  report: object;
  lines: string[];
}): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, JSON.stringify(report, null, 2));
  for (const line of lines) console.log(line);
  console.log(`Full output: ${path}`);
}
