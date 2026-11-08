// The verdicts only an Interactive session gets: its gh issue create, issue links and `gh api` reads, its review-list decisions, its research push and its ask for the Google script route.
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
  researchPushVerdictOf(
    simple: SimpleCommand,
    context: CallContext,
  ): Verdict | undefined {
    return interactiveScriptVerdictOf(
      simple,
      context,
      interactiveScripts.researchPush,
    );
  },
  googleScriptVerdictOf(
    simple: SimpleCommand,
    context: CallContext,
  ): Verdict | undefined {
    return interactiveScriptVerdictOf(
      simple,
      context,
      interactiveScripts.googleScript,
    );
  },
};

// A script only an Interactive session runs: `stepWhy` is a runner step's refusal, `sessionVerdict` the session's.
interface InteractiveScript {
  name: string;
  stepWhy: string;
  sessionVerdict: Verdict;
}

const interactiveScripts = {
  // A standing yes behind wrap-up's secret scan; a runner step's is refused, as nobody reads what it publishes.
  researchPush: {
    name: "research:push",
    stepWhy:
      "pushes a `research/*` branch, which only an Interactive session does",
    sessionVerdict: {
      permissionDecision: "allow",
      why: "`npm run research:push` is the standing yes to push a `research/*` branch, behind wrap-up's secret scan",
    },
  },
  // Asks in an Interactive session, as the script runs outside the box; a runner step's is refused, as runner steps haven't needed one.
  googleScript: {
    name: "google:script",
    stepWhy:
      "runs an agent-written script holding the agent account's access token, which only an Interactive session does",
    sessionVerdict: {
      permissionDecision: "ask",
      why: "`npm run google:script` runs the script with the agent account's access token, and outside the box, so nothing stops it reading the credential files the box hides",
    },
  },
} as const satisfies Record<string, InteractiveScript>;

function interactiveScriptVerdictOf(
  { words }: SimpleCommand,
  { mode }: CallContext,
  { name, stepWhy, sessionVerdict }: InteractiveScript,
): Verdict | undefined {
  if (npmCommands.isPrefixed(words)) return undefined;
  if (npmCommands.scriptOf(words)?.name !== name) return undefined;
  if (mode !== "interactive") {
    return { permissionDecision: "ask", why: stepWhy };
  }
  return sessionVerdict;
}
