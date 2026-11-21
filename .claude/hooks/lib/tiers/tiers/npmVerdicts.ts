// The verdicts on npm and npx calls, from what npmCommands.ts reads off their words: live sends and their flags, free scripts, and the calls that ask.
import type { SimpleCommand } from "../ShellParser.ts";
import type { CallContext, Verdict } from "../tiers.ts";
import { npmCommands } from "./npmCommands.ts";

const untargetedPrograms = new Set([
  "clasp",
  "@google/clasp",
  "sheets-framework",
  "@byronbroughten/sheets-framework",
]);
// A free script's flag that takes it out of its free row.
const askingFlags = [
  {
    script: "issue:remove",
    flag: "--force",
    why: "discards a workspace's unlanded work, which git can't bring back",
  },
  {
    script: "session:probe",
    flag: "--keep-excluded",
    why: "runs each listed command an `excludedCommands` entry matches outside the sandbox, in a session no hook gates",
  },
] as const;
// The flags that take a live alias out of its row: the framework sends a held deletion or overwrite only under `--confirm`, and `--force` overwrites a person's edit.
const liveFlags = {
  confirm: "--confirm",
  force: "--force",
} as const;
const liveFlagWhys = {
  stepConfirm:
    "a runner step's `--confirm` sends what its dry run held, which only the developer approves, so record a `denied-tool` blocker quoting the held list the dry run printed and the ready `--confirm <token>` command, for the developer to run",
  force:
    "holds `--force`, which sends a trait over the sheet's value and so overwrites a person's edit",
  appConfirm:
    "holds `--confirm`, which sends the deletions and overwrites of entered data its dry run held",
  devConfirm:
    "the dev spreadsheet holds no business data, and Google's version history undoes a `--confirm` send",
} as const;

export const npmVerdicts = {
  // A live alias's send needs its dry run before any flag is weighed, and a chore's send after one is otherwise allowed.
  liveSendVerdictOf(
    { words }: SimpleCommand,
    { mode, dryRuns }: CallContext,
  ): Verdict | undefined {
    const sendVerdict = npmCommands.sendVerdictOf(words, dryRuns);
    if (sendVerdict?.permissionDecision === "deny") return sendVerdict;
    return liveFlagVerdictOf(words, mode) ?? sendVerdict;
  },
  untargetedVerdictOf({ words }: SimpleCommand): Verdict | undefined {
    const run = npmCommands.programRunOf(words);
    if (!run) return undefined;
    if (
      ![run.program, ...run.packages].some((name) =>
        untargetedPrograms.has(name),
      )
    ) {
      return undefined;
    }
    return {
      permissionDecision: "ask",
      why: "names no target; use a `dev:*` or `app:*` script",
    };
  },
  // npmCommands.scriptOf drops flags, so the raw words are searched for the flag.
  askingFlagVerdictOf({ words }: SimpleCommand): Verdict | undefined {
    const scriptName = npmCommands.scriptOf(words)?.name;
    const why = askingFlags.find(
      ({ script, flag }) => script === scriptName && words.includes(flag),
    )?.why;
    if (!why) return undefined;
    return { permissionDecision: "ask", why };
  },
  freeScriptVerdictOf({ words }: SimpleCommand): Verdict | undefined {
    const freeWhy = npmCommands.freeScriptWhyOf(words);
    if (!freeWhy) return undefined;
    return { permissionDecision: "allow", why: freeWhy };
  },
};

// The raw words are searched, as npmCommands.scriptOf drops flags; one before npm's `--` counts too, being stricter.
function liveFlagVerdictOf(
  words: string[],
  mode: CallContext["mode"],
): Verdict | undefined {
  const spreadsheet = /^(app|dev):/.exec(
    npmCommands.scriptOf(words)?.name ?? "",
  )?.[1];
  if (!spreadsheet) return undefined;
  const isConfirm = holdsFlag(words, liveFlags.confirm);
  if (isConfirm && mode === "runnerStep") {
    return { permissionDecision: "deny", why: liveFlagWhys.stepConfirm };
  }
  if (holdsFlag(words, liveFlags.force)) {
    return { permissionDecision: "ask", why: liveFlagWhys.force };
  }
  if (!isConfirm) return undefined;
  if (spreadsheet === "app") {
    return { permissionDecision: "ask", why: liveFlagWhys.appConfirm };
  }
  return { permissionDecision: "allow", why: liveFlagWhys.devConfirm };
}

function holdsFlag(words: string[], flag: string): boolean {
  return words.some((word) => word === flag || word.startsWith(`${flag}=`));
}
