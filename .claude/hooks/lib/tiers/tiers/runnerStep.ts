// The verdicts only a runner step gets: its gh issue writes, its targets' live aliases and a restore in its own workspace.
import type { SimpleCommand } from "../ShellParser.ts";
import type { CallContext, Verdict } from "../tiers.ts";
import { GitCall, gitPathOptions } from "./GitCall.ts";
import { npmCommands } from "./npmCommands.ts";
import { PathChecker } from "./PathChecker.ts";

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
  ghVerdictOf(
    { words }: SimpleCommand,
    { mode }: CallContext,
  ): Verdict | undefined {
    if (mode !== "runnerStep") return undefined;
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
    { words }: SimpleCommand,
    { mode, dryRuns, spreadsheetTargets }: CallContext,
  ): Verdict | undefined {
    if (mode !== "runnerStep") return undefined;
    const name = npmCommands.scriptOf(words)?.name ?? "";
    const [, spreadsheet = "", alias = ""] = /^(\w+):(.+)$/.exec(name) ?? [];
    const aliases = liveAliases.get(spreadsheet);
    if (!aliases) return undefined;
    if (npmCommands.isPrefixed(words)) {
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
    const sendVerdict = npmCommands.choreSendVerdictOf(words, dryRuns);
    if (sendVerdict) return sendVerdict;
    return {
      permissionDecision: "allow",
      why: `the ticket targets the \`${spreadsheet}\` spreadsheet`,
      needsPlainText: true,
    };
  },
  // A runner step's workspace holds only that step's work, so a restore there loses nothing anyone else made.
  restoreVerdictOf(
    { words, isBare }: SimpleCommand,
    { mode, places }: CallContext,
  ): Verdict | undefined {
    if (mode !== "runnerStep") return undefined;
    const git = GitCall.init(words);
    if (!git?.isPlain || !isBare || git.verb !== "restore") return undefined;
    const pointsElsewhere = words.some((word) =>
      gitPathOptions.has(word.split("=")[0] ?? ""),
    );
    if (pointsElsewhere) return undefined;
    if (!PathChecker.init(places).isCwdInWorkspaceCheckout) return undefined;
    return {
      permissionDecision: "allow",
      why: "a runner step's `git restore` changes only its own workspace",
      needsPlainText: true,
    };
  },
};
