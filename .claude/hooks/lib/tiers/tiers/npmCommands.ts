// What an npm, npx or npm exec call runs, read off its words: the program, a free script and an app chore.
import type { Verdict } from "../tiers.ts";

export interface NpmScript {
  name: string;
  args: string[];
}

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
  ["issue:release", "`issue:start` takes the lease back"],
  ["issue:remove", "a plain remove refuses a workspace holding unlanded work"],
  ["issue:backlink", "a further `gh issue edit` undoes it"],
  ["issue:read", "it only reads an issue"],
  ["issue:promote", "a promoted repo comes off with its workspace"],
  ["jev", freeWhys.jev],
  ["jev:style", freeWhys.jev],
  ["outline", "it only reads a file"],
  ["outcome:summary", "it only reads the outcome log and issues"],
  ["prompt:scan", "it only reads transcripts"],
  [
    "ws:rm",
    "it deletes only files git tracks in a Workspace, which git restores",
  ],
  [
    "session:probe",
    "its one-turn session only reports what the folder's hooks see, or with --sandbox-check runs each listed command once inside the folder's sandbox",
  ],
  ["check", freeWhys.check],
  ["tsc", freeWhys.check],
  ["lint", freeWhys.check],
  ["test", freeWhys.check],
]);
const npmVerbs = {
  exec: new Set(["exec", "x"]),
  run: new Set(["run", "run-script"]),
  test: new Set(["test", "t"]),
} as const;
// npm options that take the next word as their value.
const npmValueFlags = new Set([
  "--prefix",
  "-C",
  "-w",
  "--workspace",
  "--loglevel",
  "--userconfig",
  "--cache",
  "--registry",
  "--script-shell",
]);

export const npmCommands = {
  // An `npm run` script and its args; flags drop out except `--` and `--send`.
  scriptOf(words: string[]): NpmScript | undefined {
    if (!npmCommands.isNpm(words)) return undefined;
    const rest = words
      .slice(1)
      .filter((word) => !/^-/.test(word) || word === "--" || word === "--send");
    if (!npmVerbs.run.has(rest[0] ?? "") || !rest[1]) return undefined;
    return { name: rest[1], args: rest.slice(2) };
  },
  // The program a command runs, through npx or npm exec, without its path or version.
  programOf(words: string[]): string | undefined {
    let rest = words;
    if (basenameOf(words[0] ?? "") === "npx") rest = words.slice(1);
    else if (
      npmCommands.isNpm(words) &&
      npmVerbs.exec.has(nonFlagsOf(words)[1] ?? "")
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
    const scriptName = npmCommands.scriptOf(words)?.name ?? npmTestOf(words);
    return scriptName && freeScripts.get(scriptName);
  },
  // npm keeps a `--send` before its `--` as its own config, so only one after it reaches the chore.
  appChoreOf(words: string[]): AppChore | undefined {
    const script = npmCommands.scriptOf(words);
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
  // The words as a settings rule spells them: npm's flags before the script name dropped, and `npm t` written `npm test`.
  unflaggedFormOf(words: string[]): string {
    if (!npmCommands.isNpm(words)) return words.join(" ");
    const verbAt = afterFlagsOf(words, 1);
    const verb = words[verbAt] ?? "";
    if (npmVerbs.test.has(verb)) {
      return ["npm", "test", ...words.slice(verbAt + 1)].join(" ");
    }
    if (!npmVerbs.run.has(verb)) return words.join(" ");
    const scriptAt = afterFlagsOf(words, verbAt + 1);
    return ["npm", "run", ...words.slice(scriptAt)].join(" ");
  },
};

// `npm test` and `npm t`, which need no `run`.
function npmTestOf(words: string[]): string | undefined {
  if (!npmCommands.isNpm(words)) return undefined;
  return npmVerbs.test.has(nonFlagsOf(words)[1] ?? "") ? "test" : undefined;
}

function afterFlagsOf(words: string[], at: number): number {
  let index = at;
  while ((words[index] ?? "").startsWith("-") && words[index] !== "--") {
    index += npmValueFlags.has(words[index] ?? "") ? 2 : 1;
  }
  return index;
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
