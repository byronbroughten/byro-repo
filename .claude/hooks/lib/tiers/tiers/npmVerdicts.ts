// The verdicts on npm and npx calls, from what npmCommands.ts reads off their words: chore sends and free scripts, and the calls that ask.
import type { SimpleCommand } from "../ShellParser.ts";
import type { CallContext, Verdict } from "../tiers.ts";
import { npmCommands } from "./npmCommands.ts";

const untargetedPrograms = new Set([
  "clasp",
  "@google/clasp",
  "sheets-framework",
  "@byronbroughten/sheets-framework",
]);

export const npmVerdicts = {
  choreSendVerdictOf(
    { words }: SimpleCommand,
    { dryRuns }: CallContext,
  ): Verdict | undefined {
    return npmCommands.choreSendVerdictOf(words, dryRuns);
  },
  untargetedVerdictOf({ words }: SimpleCommand): Verdict | undefined {
    if (!untargetedPrograms.has(npmCommands.programOf(words) ?? "")) {
      return undefined;
    }
    return {
      permissionDecision: "ask",
      why: "names no target; use a `dev:*` or `app:*` script",
    };
  },
  // npmCommands.scriptOf drops flags, so the raw words are searched for --force.
  forcedRemoveVerdictOf({ words }: SimpleCommand): Verdict | undefined {
    const isForcedRemove =
      npmCommands.scriptOf(words)?.name === "issue:remove" &&
      words.includes("--force");
    if (!isForcedRemove) return undefined;
    return {
      permissionDecision: "ask",
      why: "discards a workspace's unlanded work, which git can't bring back",
    };
  },
  freeScriptVerdictOf({ words }: SimpleCommand): Verdict | undefined {
    const freeWhy = npmCommands.freeScriptWhyOf(words);
    if (!freeWhy) return undefined;
    return { permissionDecision: "allow", why: freeWhy };
  },
};
