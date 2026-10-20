// Decides the context nudge: whether the session's peak context, read by the runner's context meter, has passed the ticket budget. Pure; contextNudge.ts does the I/O.
import { ContextMeter } from "@byronbroughten/spec-runner/contextMeter";
import {
  isSessionKey,
  type LeasedWorkspace,
} from "@byronbroughten/spec-runner/IssueWorkspaces";
import type { RunKnobs } from "@byronbroughten/spec-runner/runKnobs";

import type { SessionMode } from "./tiers.ts";

export type ContextNudgeKnobs = Pick<
  RunKnobs,
  "ticketBudget" | "handoffDocPath"
>;

// The budget sizes tickets, so it binds a runner step or a session holding an issue workspace; other sessions are the operator's to pace.
export function isTicketWork(
  mode: SessionMode,
  held: LeasedWorkspace[],
): boolean {
  return mode === "runnerStep" || held.some(({ key }) => !isSessionKey(key));
}

export function contextNudgeContext(
  transcript: string,
  { ticketBudget, handoffDocPath }: ContextNudgeKnobs,
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
    "Then recommend a fresh session to the developer."
  );
}
