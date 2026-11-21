// What an npm, npx or npm exec call runs, read off its words: the program, a free script and an app chore.
import type { Verdict } from "../tiers.ts";

export interface NpmScript {
  name: string;
  args: string[];
}

export interface ProgramRun {
  program: string;
  // What npx's `-p`/`--package` installs for the program to run from.
  packages: string[];
  args: string[];
}

// An app chore's or sync's run: the name its dry run is recorded under and the command that dry-runs it.
interface AppRun {
  kind: "chore" | "sync";
  dryRun: string;
  dryRunCommand: string;
  isSend: boolean;
}

interface LiveAlias {
  spreadsheet: string;
  alias: string;
}

// A chore's name is an identifier, so no chore's dry run can be recorded under this one.
const syncDryRun = "app:sync";

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
  ["map:next", "it only reads a map and its tickets"],
  ["issue:promote", "a promoted repo comes off with its workspace"],
  ["jev", freeWhys.jev],
  ["outline", "it only reads a file"],
  ["doc:sections", "it only reads a tracked rule doc"],
  ["image:render", "it only writes a PNG beside the SVG it names"],
  ["outcome:summary", "it only reads the outcome log and issues"],
  ["prompt:scan", "it only reads transcripts"],
  [
    "repos",
    "it reads the repo map and GitHub, and writes only its cache under `.runner/`",
  ],
  [
    "ws:rm",
    "it deletes only files git tracks in a Workspace, which git restores",
  ],
  [
    "session:probe",
    "its one-turn session only reports what the folder's hooks see; with --sandbox-check it runs each listed command once inside the folder's sandbox, and with --injection-check it runs throwaway skills under temp whose injected brief, described in the usage text of scripts/runner/sessionProbe.ts, runs inside that sandbox",
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
// npx and npm exec options that take the next word as a package, not the program.
const packageFlags = new Set(["-p", "--package"]);

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
  // The program a command runs, through npx or npm exec, without its path or version, and the words after it.
  programRunOf(words: string[]): ProgramRun | undefined {
    let rest = words;
    if (basenameOf(words[0] ?? "") === "npx") rest = words.slice(1);
    else if (
      npmCommands.isNpm(words) &&
      npmVerbs.exec.has(nonFlagsOf(words)[1] ?? "")
    ) {
      rest = words.slice(words.indexOf(nonFlagsOf(words)[1] ?? "") + 1);
    }
    const programAt = programAtOf(rest);
    const program = rest[programAt];
    if (program === undefined) return undefined;
    return {
      program: programNameOf(program),
      packages: packagesOf(rest.slice(0, programAt)).map(programNameOf),
      args: rest.slice(programAt + 1),
    };
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
  appRunOf(words: string[]): AppRun | undefined {
    const script = npmCommands.scriptOf(words);
    if (script?.name === "app:sync") {
      return {
        kind: "sync",
        dryRun: syncDryRun,
        dryRunCommand: "npm run app:sync",
        isSend: isSendOf(script.args),
      };
    }
    if (script?.name !== "app:chore") return undefined;
    const name = script.args.find((arg) => !arg.startsWith("-"));
    if (!name) return undefined;
    return {
      kind: "chore",
      dryRun: name,
      dryRunCommand: `npm run app:chore ${name}`,
      isSend: isSendOf(script.args),
    };
  },
  // An app chore's or sync's send: refused with no dry run of it this session; after one a chore's is allowed and a sync's left to its alias's row.
  sendVerdictOf(words: string[], dryRuns: string[]): Verdict | undefined {
    const run = npmCommands.appRunOf(words);
    if (!run?.isSend) return undefined;
    if (!dryRuns.includes(run.dryRun)) {
      return {
        permissionDecision: "deny",
        why: `this session has no dry run of \`${run.dryRun}\` to preview the send; run \`${run.dryRunCommand}\` first`,
      };
    }
    if (run.kind === "sync") return undefined;
    return {
      permissionDecision: "allow",
      why: `this session dry-ran \`${run.dryRun}\` before sending it`,
    };
  },
  // The spreadsheet and alias a live `app:*` or `dev:*` script names.
  liveAliasOf(words: string[]): LiveAlias | undefined {
    const name = npmCommands.scriptOf(words)?.name ?? "";
    const [, spreadsheet, alias] = /^(app|dev):(.+)$/.exec(name) ?? [];
    if (!spreadsheet || !alias) return undefined;
    return { spreadsheet, alias };
  },
  // The raw words are searched, as scriptOf drops flags; one before npm's `--` counts too, being stricter.
  holdsFlag(words: string[], flag: string): boolean {
    return words.some((word) => word === flag || word.startsWith(`${flag}=`));
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

// npm keeps a `--send` before its `--` as its own config, so only one after it reaches the chore or sync.
function isSendOf(args: string[]): boolean {
  const separator = args.indexOf("--");
  return separator >= 0 && args.slice(separator).includes("--send");
}

function nonFlagsOf(words: string[]): string[] {
  return words.filter((word) => !word.startsWith("-"));
}

function programAtOf(words: string[]): number {
  let index = 0;
  while ((words[index] ?? "").startsWith("-")) {
    index += packageFlags.has(words[index] ?? "") ? 2 : 1;
  }
  return index;
}

function packagesOf(flagWords: string[]): string[] {
  return flagWords.flatMap((word, at) => {
    if (packageFlags.has(word)) return [flagWords[at + 1] ?? ""];
    if (word.startsWith("--package=")) {
      return [word.slice("--package=".length)];
    }
    return [];
  });
}

function programNameOf(program: string): string {
  return basenameOf(program.replace(/(.)@[^/]*$/, "$1"));
}

// A scoped package keeps its scope; a path keeps only its last part.
function basenameOf(program: string): string {
  if (program.startsWith("@")) return program;
  return program.slice(program.lastIndexOf("/") + 1);
}
