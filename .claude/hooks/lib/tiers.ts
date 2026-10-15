// Decides the gate for a Bash call by tier: 1 and 2 are free (git or Google's version history undoes them), 3 asks. Pure; tierGate.ts does the I/O.
import { commandWordsOf } from "./bashReads.ts";
import { npmScriptOf } from "./pinnedTargets.ts";

// A runner step's mode arrives in a later ticket.
export type SessionMode = "interactive";

export interface ShellCall {
  command: string;
  mode: SessionMode;
  dryRuns: string[];
}

export interface GateDecision {
  permissionDecision: "allow" | "ask" | "deny";
  reason: string;
}

// One simple command's verdict; `why` finishes a sentence about it.
interface Verdict {
  permissionDecision: GateDecision["permissionDecision"];
  why: string;
}

interface AppChore {
  name: string;
  isSend: boolean;
}

const untargeted = new Set(["clasp", "sheets-framework", "@google/clasp"]);
// npm scripts that are free, each with why.
const freeScripts: Record<string, string> = {
  "wrap-up": "`npm run wrap-up` is the standing yes to push",
  "app:build": "Apps Script keeps the pushed code's version history",
  "app:deploy": "a deployment can be rolled back to an earlier version",
  "dev:deploy": "a deployment can be rolled back to an earlier version",
};

export function gateDecision({
  command,
  dryRuns,
}: ShellCall): GateDecision | undefined {
  const commands = parsedCommandsOf(command);
  if (!commands) return undefined;
  const verdicts = commands.map((words) => verdictOf(words, dryRuns));
  const deny = verdicts.find(
    (verdict) => verdict?.permissionDecision === "deny",
  );
  if (deny) {
    return { permissionDecision: "deny", reason: `Tier gate: ${deny.why}.` };
  }
  const ask = verdicts.find((verdict) => verdict?.permissionDecision === "ask");
  if (ask) {
    return {
      permissionDecision: "ask",
      reason: `Tier gate: \`${command}\` ${ask.why}, so it needs a yes.`,
    };
  }
  if (!verdicts.every((verdict) => verdict?.permissionDecision === "allow")) {
    return undefined;
  }
  return {
    permissionDecision: "allow",
    reason: `Tier gate: ${verdicts.map((verdict) => verdict?.why).join("; ")}.`,
  };
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
  const program =
    words[0] === "npx"
      ? words.find((word, i) => i > 0 && !word.startsWith("-"))
      : words[0];
  if (untargeted.has(program ?? "")) {
    return {
      permissionDecision: "ask",
      why: "names no target; use a `dev:*` or `app:*` script",
    };
  }
  if (npmVerbOf(words) === "publish") {
    return {
      permissionDecision: "ask",
      why: "publishes a package, which reaches everyone who installs it",
    };
  }
  const script = npmScriptOf(words);
  const freeWhy = script && freeScripts[script.name];
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

function appChoreOf(words: string[]): AppChore | undefined {
  const script = npmScriptOf(words);
  if (script?.name !== "app:chore") return undefined;
  const name = script.args.find((arg) => !arg.startsWith("-"));
  if (!name) return undefined;
  return { name, isSend: script.args.includes("--send") };
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

function npmVerbOf(words: string[]): string | undefined {
  if (words[0] !== "npm") return undefined;
  return words.slice(1).find((word) => !word.startsWith("-"));
}
