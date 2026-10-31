// What the tier gate says now about a Bash call a transcript recorded, and which simple command in it decided that.
import {
  commandVerdictsOf,
  type Decision,
  gateDecision,
  type ShellCall,
} from "../../.claude/hooks/lib/tiers/tiers.ts";

export type GateOutcome = "free" | "asks" | "refuses" | "unclassified";

export interface GateReplay {
  outcome: GateOutcome;
  // The simple command that decided it; absent when the call as a whole did.
  words?: string[];
  why: string;
}

const outcomes: Record<Decision["permissionDecision"], GateOutcome> = {
  allow: "free",
  ask: "asks",
  deny: "refuses",
};

export function gateReplayOf(call: ShellCall): GateReplay {
  const commandVerdicts = commandVerdictsOf(call);
  if (!commandVerdicts) {
    return { outcome: "unclassified", why: "the gate can't parse it" };
  }
  const decision = gateDecision(call);
  if (!decision) {
    const undecided = commandVerdicts.find(({ verdict }) => !verdict);
    if (undecided) {
      return {
        outcome: "unclassified",
        words: undecided.words,
        why: "no tier row matches it",
      };
    }
    return {
      outcome: "unclassified",
      words: commandVerdicts[0]?.words,
      why: "each part is free, but a heredoc or `$'…'` could hide another command",
    };
  }
  const deciding = commandVerdicts.find(
    ({ verdict }) =>
      verdict?.permissionDecision === decision.permissionDecision,
  );
  return {
    outcome: outcomes[decision.permissionDecision],
    words: deciding?.words,
    why: deciding?.verdict?.why ?? decision.reason,
  };
}
