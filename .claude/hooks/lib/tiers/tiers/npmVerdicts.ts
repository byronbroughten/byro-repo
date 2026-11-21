// The verdicts on npm and npx calls, from what npmCommands.ts reads off their words: live sends and their flags, free scripts, and the calls that ask.
import type { SimpleCommand } from "../ShellParser.ts";
import type { CallContext, Verdict } from "../tiers.ts";
import type { HeldSends } from "./heldSends.ts";
import { npmCommands } from "./npmCommands.ts";

const untargetedPrograms = new Set([
  "clasp",
  "@google/clasp",
  "sheets-framework",
  "@byronbroughten/sheets-framework",
]);
const frameworkScriptPath = /(^|\/)packages\/framework\/scripts\//;
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
export const liveFlags = {
  confirm: "--confirm",
  force: "--force",
} as const;
const liveFlagWhys = {
  force:
    "holds `--force`, which sends a trait over the sheet's value and so overwrites a person's edit",
  appConfirm:
    "holds `--confirm`, which sends the deletions and overwrites of entered data its dry run held",
  appConfirmAtDiscretion:
    "holds `--confirm`, which the developer's `heldSends` setting of `agentDiscretion` leaves to the agent's rule for a held send",
  devConfirm:
    "the dev spreadsheet holds no business data, and Google's version history undoes a `--confirm` send",
} as const;

export const npmVerdicts = {
  // A live alias's send needs its dry run before any flag is weighed, and a chore's send after one is otherwise allowed.
  liveSendVerdictOf(
    { words }: SimpleCommand,
    { dryRuns, heldSends }: CallContext,
  ): Verdict | undefined {
    const sendVerdict = npmCommands.sendVerdictOf(words, dryRuns);
    if (sendVerdict?.permissionDecision === "deny") return sendVerdict;
    return liveFlagVerdictOf(words, heldSends) ?? sendVerdict;
  },
  untargetedVerdictOf({ words }: SimpleCommand): Verdict | undefined {
    if (!npmVerdicts.namesNoTarget(words)) return undefined;
    return {
      permissionDecision: "ask",
      why: "names no target; use a `dev:*` or `app:*` script",
    };
  },
  // A bare clasp or framework bin, through npx or a framework script run with node.
  namesNoTarget(words: string[]): boolean {
    const run = npmCommands.programRunOf(words);
    if (!run) return false;
    if (run.program === "node") {
      return run.args.some((word) => frameworkScriptPath.test(word));
    }
    return [run.program, ...run.packages].some((name) =>
      untargetedPrograms.has(name),
    );
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

// A runner step's `--confirm` never gets here: runnerStep.ts refuses it first, whatever the setting.
function liveFlagVerdictOf(
  words: string[],
  heldSends: HeldSends,
): Verdict | undefined {
  const spreadsheet = npmCommands.liveAliasOf(words)?.spreadsheet;
  if (!spreadsheet) return undefined;
  if (npmCommands.holdsFlag(words, liveFlags.force)) {
    return { permissionDecision: "ask", why: liveFlagWhys.force };
  }
  if (!npmCommands.holdsFlag(words, liveFlags.confirm)) return undefined;
  if (spreadsheet === "app") {
    if (heldSends === "agentDiscretion") {
      return {
        permissionDecision: "allow",
        why: liveFlagWhys.appConfirmAtDiscretion,
      };
    }
    return { permissionDecision: "ask", why: liveFlagWhys.appConfirm };
  }
  return { permissionDecision: "allow", why: liveFlagWhys.devConfirm };
}
