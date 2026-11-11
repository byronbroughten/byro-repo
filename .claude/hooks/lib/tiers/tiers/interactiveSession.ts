// The verdicts only an Interactive session gets: its gh issue create, issue links and `gh api` reads, and its review-list decisions. Its scripts' verdicts are interactiveScripts.ts's.
import { GhApiCall } from "../GhApiCall.ts";
import type { SimpleCommand } from "../ShellParser.ts";
import type { CallContext, Verdict } from "../tiers.ts";
import { npmCommands } from "./npmCommands.ts";

export const interactiveSession = {
  // An Interactive session's issue create, issue links and `gh api` reads; a runner step's stay refused, as its reads go through `issue:read`'s Trusted and Untrusted labels.
  ghVerdictOf(
    { words }: SimpleCommand,
    { mode }: CallContext,
  ): Verdict | undefined {
    const [program, verb, ...args] = words;
    if (mode !== "interactive" || program !== "gh") return undefined;
    if (verb === "issue" && args[0] === "create") {
      return {
        permissionDecision: "allow",
        why: "`gh issue close` undoes it",
        needsPlainText: true,
      };
    }
    if (verb !== "api") return undefined;
    const call = GhApiCall.init(args);
    if (call?.isRead) {
      return {
        permissionDecision: "allow",
        why: "a `gh api` call with no body only reads",
        needsPlainText: true,
      };
    }
    if (call?.isCommentEdit) {
      return {
        permissionDecision: "allow",
        why: "a further edit undoes an issue comment's edit",
        needsPlainText: true,
      };
    }
    if (!call?.isIssueLink) return undefined;
    return {
      permissionDecision: "allow",
      why: "the opposite `gh api` call undoes an issue link",
      needsPlainText: true,
    };
  },
  // An Interactive session's review-list decision, free as a raw comment PATCH is; a runner step's stays refused.
  decideVerdictOf(
    { words }: SimpleCommand,
    { mode }: CallContext,
  ): Verdict | undefined {
    if (mode !== "interactive" || npmCommands.isPrefixed(words)) {
      return undefined;
    }
    const script = npmCommands.scriptOf(words);
    if (script?.name !== "runner") return undefined;
    const [verb] = script.args.filter((arg) => arg !== "--");
    if (verb !== "decide") return undefined;
    return {
      permissionDecision: "allow",
      why: "a further edit undoes a review-list item's decision",
      needsPlainText: true,
    };
  },
};
