// The verdicts for the scripts only an Interactive session runs: its research push, its ticket filing, its ask for the Google script route and its standing yes to the Doc print command. Its gh calls and review-list decisions are interactiveSession.ts's.
import type { SimpleCommand } from "../ShellParser.ts";
import type { CallContext, Verdict } from "../tiers.ts";
import { npmCommands } from "./npmCommands.ts";

export const interactiveScripts = {
  // The research push, the ticket filing, the Google script route and the Doc print command: a runner step's is refused, an Interactive session's gets its script's verdict.
  scriptVerdictOf(
    { words }: SimpleCommand,
    { mode }: CallContext,
  ): Verdict | undefined {
    if (npmCommands.isPrefixed(words)) return undefined;
    const name = npmCommands.scriptOf(words)?.name;
    const script = Object.values(scripts).find(
      (candidate: InteractiveScript) => candidate.name === name,
    );
    if (!script) return undefined;
    if (mode !== "interactive") {
      return { permissionDecision: "ask", why: script.stepWhy };
    }
    return script.sessionVerdict;
  },
};

// A script only an Interactive session runs: `stepWhy` is a runner step's refusal, `sessionVerdict` the session's.
interface InteractiveScript {
  name: string;
  stepWhy: string;
  sessionVerdict: Verdict;
}

const scripts = {
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
  // Free as the `gh issue create` and `gh api` sub-issue and dependency calls it wraps are; a runner step's is refused, as theirs are.
  issueFile: {
    name: "issue:file",
    stepWhy: "files issues, which only an Interactive session does",
    sessionVerdict: {
      permissionDecision: "allow",
      why: "`gh issue close` undoes each issue `npm run issue:file` creates, and the opposite call each sub-issue and blocked-by link",
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
  // A standing yes in an Interactive session: the token is the agent account's, reaching only files shared with it, and the switch back to the `clasp` login is easy; a runner step's is refused, as no ticket has targeted a Doc it reads.
  docPrint: {
    name: "doc:print",
    stepWhy:
      "reads a Doc with the agent account's access token, which only an Interactive session does",
    sessionVerdict: {
      permissionDecision: "allow",
      why: "`npm run doc:print` is the standing yes to read a Doc as the agent account, whose token reaches only the files shared with that account",
    },
  },
} as const satisfies Record<string, InteractiveScript>;
