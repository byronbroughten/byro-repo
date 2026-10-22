// The context nudge: once a session's peak context reaches the ticket budget, the handoff reminder it gets; a repo's hook does the I/O.
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
