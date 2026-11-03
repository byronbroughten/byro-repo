// SessionStart's warning that the sandbox state is off, in the words the tier gate's off ask uses; the hook of the same name does the I/O.
import { sandboxOffWords, type SandboxState } from "./sandboxState.ts";

export function sandboxOffContextOf({ off }: SandboxState): string | undefined {
  if (off === undefined) return undefined;
  return [
    `For this session, ${sandboxOffWords.offClause(off)}.`,
    `${callsThatAskOf(off.excludedCommands)} will ask for a yes, and in a runner step be refused.`,
    sandboxOffWords.turnBackOn(off),
  ].join(" ");
}

// A layer that can't be parsed leaves no entries, so no call is spared the ask.
function callsThatAskOf(excludedCommands: string[]): string {
  if (excludedCommands.length === 0) return "Every Bash call";
  return `Every Bash call not ${sandboxOffWords.madeOfEntries}`;
}
