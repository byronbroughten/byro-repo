// The verdicts only a runner step gets: its gh issue writes, its targets' live aliases and a restore in its own workspace.
import { npmScriptOf } from "../bashReads.ts";
import { partsClearOfGit, resolvedPathOf } from "../stepWrites.ts";
import type { CallContext, Verdict } from "../tiers.ts";
import { gitPathOptions } from "./GitCall.ts";
import { npmCommands } from "./npmCommands.ts";

const targetAliases = [
  "chore",
  "gen:configs",
  "probe",
  "build",
  "deploy",
  "configs:diff",
];
// The live aliases each spreadsheet target gives a runner step; runner/src/targetTools.ts mirrors them, as it can't import across the hooks boundary.
const liveAliases = new Map([
  ["app", targetAliases],
  ["dev", [...targetAliases, "push", "run"]],
]);
// A runner step's gh writes; a further edit or comment undoes either.
const ghStepWrites = new Set(["edit", "comment"]);

export const runnerStep = {
  // A runner step edits and comments on issues; closing one is the runner's or the developer's, and any other gh call is unclassified.
  ghVerdictOf(words: string[]): Verdict | undefined {
    if (words[0] !== "gh" || words[1] !== "issue") return undefined;
    if (words[2] === "close") {
      return {
        permissionDecision: "ask",
        why: "closes an issue, which only the runner or the developer does",
      };
    }
    if (!ghStepWrites.has(words[2] ?? "")) return undefined;
    return {
      permissionDecision: "allow",
      why: "a further `gh issue edit` or comment undoes it",
      needsPlainText: true,
      plainTextFix:
        "write the text to a file under `/tmp` and pass it with `--body-file`, then run the call again",
    };
  },
  // A runner step runs a live alias only against a spreadsheet its ticket targets.
  liveAliasVerdictOf(
    words: string[],
    { dryRuns, spreadsheetTargets }: CallContext,
  ): Verdict | undefined {
    const name = npmScriptOf(words)?.name ?? "";
    const [, spreadsheet = "", alias = ""] = /^(\w+):(.+)$/.exec(name) ?? [];
    const aliases = liveAliases.get(spreadsheet);
    if (!aliases) return undefined;
    // A --prefix runs another folder's scripts under the same name.
    if (words.some((word) => word.startsWith("--prefix"))) {
      return {
        permissionDecision: "ask",
        why: "runs another folder's script under a live alias's name",
      };
    }
    if (!spreadsheetTargets.includes(spreadsheet)) {
      return {
        permissionDecision: "ask",
        why: `runs against the \`${spreadsheet}\` spreadsheet, which the ticket doesn't target`,
      };
    }
    if (!aliases.includes(alias)) {
      return {
        permissionDecision: "ask",
        why: `isn't an alias the \`${spreadsheet}\` spreadsheet target gives a step`,
      };
    }
    const chore = npmCommands.appChoreOf(words);
    if (chore?.isSend) return npmCommands.sendVerdictOf(chore.name, dryRuns);
    return {
      permissionDecision: "allow",
      why: `the ticket targets the \`${spreadsheet}\` spreadsheet`,
      needsPlainText: true,
    };
  },
  // A runner step's workspace holds only that step's work, so a restore there loses nothing anyone else made.
  isOwnStepCheckout(words: string[], { mode, places }: CallContext): boolean {
    if (mode !== "runnerStep" || !places) return false;
    const pointsElsewhere = words.some((word) =>
      gitPathOptions.has(word.split("=")[0] ?? ""),
    );
    if (pointsElsewhere) return false;
    const cwd = resolvedPathOf(places.cwd, places);
    if (cwd === undefined) return false;
    if (
      cwd === (places.realPathOf(places.workspaceRoot) ?? places.workspaceRoot)
    ) {
      return true;
    }
    return partsClearOfGit(cwd, places.workspaceRoot, places) !== undefined;
  },
};
