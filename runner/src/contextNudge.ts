// The context nudge: once a session's peak context reaches the ticket budget, the handoff reminder it gets; a repo's hook does the I/O.
// Claude Code loads hooks only from a root's settings, so each repo registers its own PostToolUse shim on every tool.
// The shim reads the hook input, skips subagents, reads the transcript at `transcript_path`,
// passes `contextNudgeOf()` the session's id and the `ticketBudget` and `handoffDocPath` knobs
// (through `runKnobsOrDefaults()` from the repo's override file), and writes any reminder as `additionalContext`.
// Firing once per session, deciding which sessions the budget binds and failing open are the shim's.
// byro-repo's shim is `.claude/hooks/contextNudge.ts`, registered in `.claude/settings.json`.
import { ContextMeter } from "./contextMeter.ts";
import type { RunKnobs } from "./runKnobs.ts";

export type ContextNudgeKnobs = Pick<
  RunKnobs,
  "ticketBudget" | "handoffDocPath"
>;

export interface ContextNudgeOptions extends ContextNudgeKnobs {
  // Named in the message so the handoff comment's `session:` line ties it to this transcript.
  sessionId: string;
}

export function contextNudgeOf(
  transcript: string,
  { sessionId, ticketBudget, handoffDocPath }: ContextNudgeOptions,
): string | undefined {
  const size = ContextMeter.ofTranscript(transcript);
  if (size === undefined || size < ticketBudget) return undefined;
  const handoffRule =
    handoffDocPath === undefined ? "" : `, per ${handoffDocPath}`;
  return (
    `Context nudge: this session's context is ${Math.round(size / 1000)}K tokens, past the ` +
    `${ticketBudget / 1000}K ticket budget. Finish the step you are on; the handoff is your next and last step${handoffRule}: ` +
    "an issue comment, or a file if there is no issue. " +
    "If tsc, tests or lint are red, the handoff lists the changed files and what still fails (tsc errors, test names), " +
    "so the next session resumes from the working tree. Leave the work uncommitted. " +
    `End the handoff comment with \`session: ${sessionId}\`. ` +
    "Then recommend a fresh session to the developer."
  );
}
