// Decides the context nudge: whether the session's peak context, read by the runner's context meter, has passed the ticket budget. Pure; contextNudge.ts does the I/O.
import { ContextMeter } from "@byronbroughten/spec-runner/contextMeter";

// The ticket budget in docs/agents/planning.md#ticket-size.
export const ticketBudgetTokens = 150_000;

export function contextNudgeContext(transcript: string): string | undefined {
  const size = ContextMeter.ofTranscript(transcript);
  if (size === undefined || size < ticketBudgetTokens) return undefined;
  return (
    `Context nudge: this session's context is ${Math.round(size / 1000)}K tokens, past the ` +
    `${ticketBudgetTokens / 1000}K ticket budget. Finish the step you are on; the handoff is your next and last step, ` +
    "per docs/agents/planning.md#handoffs: an issue comment, or a file if there is no issue. " +
    "If tsc, tests or lint are red, the handoff lists the changed files and what still fails (tsc errors, test names), " +
    "so the next session resumes from the working tree. Leave the work uncommitted. " +
    "Then recommend a fresh session to the developer."
  );
}
