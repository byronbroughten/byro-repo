// The refusal of a `gh issue edit` adding a `ready-*` label, in either mode, since only `npm run issue:ready` checks the ticket's body before relabelling it.
import type { SimpleCommand } from "../ShellParser.ts";
import type { CallContext, Verdict } from "../tiers.ts";

// Mirrors `readyLabels` in runner/src/ticketReadiness.ts, as it can't import across the hooks boundary.
const readyLabels = new Set([
  "ready-for-agent",
  "ready-for-interactive",
  "ready-for-human",
]);
const addLabelFlag = "--add-label";

export const readyLabelEdits = {
  // A narrow refusal, never right, so a session's denies rather than asks: `issue:ready` is the way through. A runner step's asks, so the mode turns it into a refusal naming the blocker, as `issue:ready` is refused there too.
  editVerdictOf(
    { words }: SimpleCommand,
    { mode }: CallContext,
  ): Verdict | undefined {
    const [program, noun, verb, ...args] = words;
    if (program !== "gh" || noun !== "issue" || verb !== "edit") {
      return undefined;
    }
    if (!addedLabelsOf(args).some((label) => readyLabels.has(label))) {
      return undefined;
    }
    if (mode !== "interactive") {
      return {
        permissionDecision: "ask",
        why: "adds a `ready-*` label, which only `npm run issue:ready` puts on, and only in an Interactive session",
      };
    }
    return {
      permissionDecision: "deny",
      why: "a `gh issue edit` adding a `ready-*` label is refused, since only `npm run issue:ready -- <repo> <n> <label>` checks the ticket's body first",
    };
  },
};

// Each label an `--add-label` flag names, in either spelling, a comma list split.
function addedLabelsOf(args: string[]): string[] {
  return args.flatMap((arg, at) => {
    let value: string | undefined;
    if (arg === addLabelFlag) {
      value = args[at + 1];
    } else if (arg.startsWith(`${addLabelFlag}=`)) {
      value = arg.slice(addLabelFlag.length + 1);
    }
    if (value === undefined) return [];
    return value.split(",").map((label) => label.trim().toLowerCase());
  });
}
