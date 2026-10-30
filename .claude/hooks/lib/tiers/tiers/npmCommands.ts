// What an npm, npx or npm exec call runs, read off its words: the program, a free script or npx check, and an app chore.
import { npmScriptOf } from "../bashReads.ts";
import type { Verdict } from "../tiers.ts";

interface AppChore {
  name: string;
  isSend: boolean;
}

const freeWhys = {
  deploy: "a deployment can be rolled back to an earlier version",
  check: "the repo's checks write nothing git can't undo",
  jev: "agents have a standing yes to send Jev Deliverable text and repo docs",
} as const;
const freeScripts = new Map<string, string>([
  ["wrap-up", "`npm run wrap-up` is the standing yes to push"],
  ["app:build", "Apps Script keeps the pushed code's version history"],
  ["app:deploy", freeWhys.deploy],
  ["dev:deploy", freeWhys.deploy],
  ["issue:start", "a workspace it starts comes off with `issue:remove`"],
  ["issue:list", "it only reads the workspaces"],
  ["issue:remove", "a plain remove refuses a workspace holding unlanded work"],
  ["issue:backlink", "a further `gh issue edit` undoes it"],
  ["issue:read", "it only reads an issue"],
  ["issue:promote", "a promoted repo comes off with its workspace"],
  ["jev", freeWhys.jev],
  ["jev:style", freeWhys.jev],
  ["outline", "it only reads a file"],
  [
    "session:probe",
    "its one-turn session only reports what the folder's hooks see",
  ],
  ["check", freeWhys.check],
  ["tsc", freeWhys.check],
  ["lint", freeWhys.check],
  ["test", freeWhys.check],
]);
// Each check only with no flag that writes a file the write rule never sees.
const npxChecks = new Map<string, (args: string[]) => boolean>([
  [
    "vitest",
    (args) =>
      args[0] === "run" && !args.some((arg) => arg.startsWith("--outputFile")),
  ],
  [
    "tsc",
    (args) =>
      args.includes("--noEmit") &&
      !args.some((arg) => arg === "-b" || arg === "--build"),
  ],
  [
    "eslint",
    (args) =>
      !args.some(
        (arg) =>
          arg.startsWith("--fix") ||
          arg === "-o" ||
          arg.startsWith("--output-file"),
      ),
  ],
  [
    "prettier",
    (args) =>
      args.includes("--check") &&
      !args.some((arg) => arg === "--write" || arg === "-w"),
  ],
]);
const npmExecVerbs = new Set(["exec", "x"]);

export const npmCommands = {
  // The program a command runs, through npx or npm exec, without its path or version.
  programOf(words: string[]): string | undefined {
    let rest = words;
    if (basenameOf(words[0] ?? "") === "npx") rest = words.slice(1);
    else if (
      npmCommands.isNpm(words) &&
      npmExecVerbs.has(nonFlagsOf(words)[1] ?? "")
    ) {
      rest = words.slice(words.indexOf(nonFlagsOf(words)[1] ?? "") + 1);
    }
    const program = nonFlagsOf(rest)[0];
    if (program === undefined) return undefined;
    return basenameOf(program.replace(/(.)@[^/]*$/, "$1"));
  },
  // A --prefix runs another folder's scripts under the same name.
  isPrefixed(words: string[]): boolean {
    return words.some((word) => word.startsWith("--prefix"));
  },
  // Why the script a command runs is free, or undefined when it isn't one.
  freeScriptWhyOf(words: string[]): string | undefined {
    if (npmCommands.isPrefixed(words)) return undefined;
    const scriptName = npmScriptOf(words)?.name ?? npmTestOf(words);
    return scriptName && freeScripts.get(scriptName);
  },
  // Why an npx check is free, or undefined when the words aren't one.
  npxCheckWhyOf([program, tool = "", ...args]: string[]): string | undefined {
    if (program !== "npx") return undefined;
    return npxChecks.get(tool)?.(args) ? freeWhys.check : undefined;
  },
  // npm keeps a `--send` before its `--` as its own config, so only one after it reaches the chore.
  appChoreOf(words: string[]): AppChore | undefined {
    const script = npmScriptOf(words);
    if (script?.name !== "app:chore") return undefined;
    const name = script.args.find((arg) => !arg.startsWith("-"));
    if (!name) return undefined;
    const separator = script.args.indexOf("--");
    const isSend =
      separator >= 0 && script.args.slice(separator).includes("--send");
    return { name, isSend };
  },
  // An app chore's send, or undefined for any other command.
  choreSendVerdictOf(words: string[], dryRuns: string[]): Verdict | undefined {
    const chore = npmCommands.appChoreOf(words);
    if (!chore?.isSend) return undefined;
    return sendVerdictOf(chore.name, dryRuns);
  },
  isNpm(words: string[]): boolean {
    return words[0] === "npm" || words[0] === "npm.cmd";
  },
};

// `npm test` and `npm t`, which need no `run`.
function npmTestOf(words: string[]): string | undefined {
  if (!npmCommands.isNpm(words)) return undefined;
  const verb = nonFlagsOf(words)[1];
  return verb === "test" || verb === "t" ? "test" : undefined;
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

function nonFlagsOf(words: string[]): string[] {
  return words.filter((word) => !word.startsWith("-"));
}

// A scoped package keeps its scope; a path keeps only its last part.
function basenameOf(program: string): string {
  if (program.startsWith("@")) return program;
  return program.slice(program.lastIndexOf("/") + 1);
}
