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
  // The simple command that decided it, or the call's first when the call as a whole did; absent when the gate can't parse it.
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
    words: deciding?.words ?? leadingWordsOf(commandVerdicts),
    why: deciding?.verdict?.why ?? decision.reason,
  };
}

// A call the gate decided as a whole, such as one it sends to the sandbox, is named by its first command past a `cd`.
function leadingWordsOf(
  commandVerdicts: { words: string[] }[],
): string[] | undefined {
  const leading =
    commandVerdicts.find(({ words }) => words[0] !== "cd") ??
    commandVerdicts[0];
  return leading?.words;
}
