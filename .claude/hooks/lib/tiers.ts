// Decides the gate for a Bash call by tier: 1 and 2 are free (git or Google's version history undoes them), 3 asks. Pure; tierGate.ts does the I/O, and driveTiers.ts decides gworkspace calls.
import { commandWordsOf, npmScriptOf } from "./bashReads.ts";

export interface Decision {
  permissionDecision: "allow" | "ask" | "deny";
  reason: string;
}

// A runner step has nobody to answer an ask, so its asks become denials.
export type SessionMode = "interactive" | "runnerStep";

// Set by ClaudeAgentStep.ts, which can't import across the hooks boundary.
export const runnerStepMark = "BYRO_RUNNER_STEP";

export interface ShellCall {
  command: string;
  mode: SessionMode;
  dryRuns: string[];
}

// One simple command's verdict; `why` finishes a sentence about it.
interface Verdict {
  permissionDecision: Decision["permissionDecision"];
  why: string;
}

interface AppChore {
  name: string;
  isSend: boolean;
}

const untargetedPrograms = new Set([
  "clasp",
  "@google/clasp",
  "sheets-framework",
  "@byronbroughten/sheets-framework",
]);
const npmExecVerbs = new Set(["exec", "x"]);
const deployWhy = "a deployment can be rolled back to an earlier version";
const freeScripts = new Map([
  ["wrap-up", "`npm run wrap-up` is the standing yes to push"],
  ["app:build", "Apps Script keeps the pushed code's version history"],
  ["app:deploy", deployWhy],
  ["dev:deploy", deployWhy],
]);

export function gateDecision(call: ShellCall): Decision | undefined {
  const decision = baseDecision(call);
  return decision && decisionInMode(decision, call.mode);
}

export function sessionModeOf(env: NodeJS.ProcessEnv): SessionMode {
  return env[runnerStepMark] ? "runnerStep" : "interactive";
}

export function decisionInMode(
  decision: Decision,
  mode: SessionMode,
): Decision {
  if (mode === "interactive" || decision.permissionDecision !== "ask") {
    return decision;
  }
  return {
    permissionDecision: "deny",
    reason: `${decision.reason} This is a runner step, so record a \`denied-tool\` blocker for the developer instead.`,
  };
}

function baseDecision({ command, dryRuns }: ShellCall): Decision | undefined {
  const commands = parsedCommandsOf(command);
  if (!commands) return undefined;
  const verdicts = commands.map((words) => verdictOf(words, dryRuns));
  const deny = verdicts.find(
    (verdict) => verdict?.permissionDecision === "deny",
  );
  if (deny) return gateOf("deny", `${deny.why}.`);
  const ask = verdicts.find((verdict) => verdict?.permissionDecision === "ask");
  if (ask) {
    return needsYes(`\`${command}\` ${ask.why}`);
  }
  // The parser doesn't look inside quoted substitutions, so one could hide a command.
  if (/\$\(|`/.test(command)) return undefined;
  if (!verdicts.every((verdict) => verdict?.permissionDecision === "allow")) {
    return undefined;
  }
  return gateOf(
    "allow",
    `${verdicts.map((verdict) => verdict?.why).join("; ")}.`,
  );
}

// The chore names a command dry-runs, for the session's dry-run record.
export function dryRunChoresOf(command: string): string[] {
  return (parsedCommandsOf(command) ?? []).flatMap((words) => {
    const chore = appChoreOf(words);
    return chore && !chore.isSend ? [chore.name] : [];
  });
}

function parsedCommandsOf(command: string): string[][] | undefined {
  try {
    return commandWordsOf(command);
  } catch {
    return undefined;
  }
}

export function gateOf(
  permissionDecision: Decision["permissionDecision"],
  sentence: string,
): Decision {
  return { permissionDecision, reason: `Tier gate: ${sentence}` };
}

export function needsYes(why: string): Decision {
  return gateOf("ask", `${why}, so it needs a yes.`);
}

function verdictOf(words: string[], dryRuns: string[]): Verdict | undefined {
  const chore = appChoreOf(words);
  if (chore?.isSend) return sendVerdictOf(chore.name, dryRuns);
  const gitVerb = gitVerbOf(words);
  if (gitVerb === "commit") {
    return { permissionDecision: "allow", why: "git can undo a commit" };
  }
  if (gitVerb === "push") {
    return {
      permissionDecision: "ask",
      why: "pushes outside `npm run wrap-up`, and a push can't be taken back",
    };
  }
  if (untargetedPrograms.has(programOf(words) ?? "")) {
    return {
      permissionDecision: "ask",
      why: "names no target; use a `dev:*` or `app:*` script",
    };
  }
  const script = npmScriptOf(words);
  if (!script && isNpm(words) && words.includes("publish")) {
    return {
      permissionDecision: "ask",
      why: "publishes a package, which reaches everyone who installs it",
    };
  }
  const freeWhy = script && freeScripts.get(script.name);
  if (freeWhy) return { permissionDecision: "allow", why: freeWhy };
  return undefined;
}

function sendVerdictOf(name: string, dryRuns: string[]): Verdict {
  if (dryRuns.includes(name)) {
    return {
      permissionDecision: "allow",
      why: `this session dry-ran \`${name}\` before sending it`,
    };
  }
  return {
    permissionDecision: "deny",
    why: `this session has no dry run of \`${name}\` to preview the send; run \`npm run app:chore ${name}\` first`,
  };
}

// npm keeps a `--send` before its `--` as its own config, so only one after it reaches the chore.
function appChoreOf(words: string[]): AppChore | undefined {
  const script = npmScriptOf(words);
  if (script?.name !== "app:chore") return undefined;
  const name = script.args.find((arg) => !arg.startsWith("-"));
  if (!name) return undefined;
  const separator = script.args.indexOf("--");
  const isSend =
    separator >= 0 && script.args.slice(separator).includes("--send");
  return { name, isSend };
}

function gitVerbOf(words: string[]): string | undefined {
  if (words[0] !== "git") return undefined;
  for (let i = 1; i < words.length; i++) {
    const word = words[i] ?? "";
    if (word === "-C" || word === "-c") i++;
    else if (!word.startsWith("-")) return word;
  }
  return undefined;
}

// The program a command runs, through npx or npm exec, without its path or version.
function programOf(words: string[]): string | undefined {
  let rest = words;
  if (basenameOf(words[0] ?? "") === "npx") rest = words.slice(1);
  else if (isNpm(words) && npmExecVerbs.has(nonFlagsOf(words)[1] ?? "")) {
    rest = words.slice(words.indexOf(nonFlagsOf(words)[1] ?? "") + 1);
  }
  const program = nonFlagsOf(rest)[0];
  if (program === undefined) return undefined;
  return basenameOf(program.replace(/(.)@[^/]*$/, "$1"));
}

function isNpm(words: string[]): boolean {
  return words[0] === "npm" || words[0] === "npm.cmd";
}

function nonFlagsOf(words: string[]): string[] {
  return words.filter((word) => !word.startsWith("-"));
}

// A scoped package keeps its scope; a path keeps only its last part.
function basenameOf(program: string): string {
  if (program.startsWith("@")) return program;
  return program.slice(program.lastIndexOf("/") + 1);
}
