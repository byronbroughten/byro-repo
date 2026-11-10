// The context nudge: once a session's peak context reaches the ticket budget, the handoff reminder it gets, worded for the handoffs it owes; a repo's hook does the I/O.
// Claude Code loads hooks only from a root's settings, so each repo registers its own PostToolUse shim on every tool.
// The shim reads the hook input, skips subagents, reads the transcript at `transcript_path`,
// measures it with `sizePastBudgetOf()` against the `ticketBudget` knob, and past it passes `contextNudgeOf()` the size, the session's id,
// the handoffs it owes and the knobs (through `runKnobsOrDefaults()` from the repo's override file), writing the reminder as `additionalContext`.
// Firing once per session, deciding which handoffs a session owes and failing open are the shim's.
// byro-repo's shim is `.claude/hooks/contextNudge.ts`, registered in `.claude/settings.json`.
import { ContextMeter } from "./contextMeter.ts";
import type { RunKnobs } from "./runKnobs.ts";

export type ContextNudgeKnobs = Pick<
  RunKnobs,
  "ticketBudget" | "handoffDocPath"
>;

// A Supervisor's handoff, from SupervisionRecords.ts.
export interface SupervisionHandoff {
  // The spec's or Batch's handoff file, which the next `supervise` reads once.
  path: string;
  // The `/runner <owner/repo> <n>` line the developer runs after `/clear`.
  rejoinCommand: string;
}

// The ticket's handoff, the supervision's, or both; never neither.
export type OwedHandoffs =
  | { isTicketOwed: true; supervision?: SupervisionHandoff }
  | { isTicketOwed: false; supervision: SupervisionHandoff };

export interface ContextNudgeOptions extends ContextNudgeKnobs {
  // Named in the message so the handoff comment's `session:` line ties it to this transcript.
  sessionId: string;
  owed: OwedHandoffs;
}

// The peak context once it reaches the budget, so a shim reads what a session owes only past it.
export function sizePastBudgetOf(
  transcript: string,
  ticketBudget: number,
): number | undefined {
  const size = ContextMeter.ofTranscript(transcript);
  if (size === undefined || size < ticketBudget) return undefined;
  return size;
}

export function contextNudgeOf(
  size: number,
  options: ContextNudgeOptions,
): string {
  const { ticketBudget, owed } = options;
  const budgetKind = owed.supervision === undefined ? "ticket" : "context";
  return (
    `Context nudge: this session's context is ${Math.round(size / 1000)}K tokens, ` +
    `past the ${ticketBudget / 1000}K ${budgetKind} budget. Finish the step you are on; ${handoffStepsOf(options)}`
  );
}

function handoffStepsOf(options: ContextNudgeOptions): string {
  const { supervision, isTicketOwed } = options.owed;
  if (supervision === undefined) {
    return `${oneHandoffOf(ticketHandoffOf(options))} Then recommend a fresh session to the developer.`;
  }
  const supervisionHandoff = `: ${supervisionHandoffOf(supervision)}`;
  const clearLine = `Then tell the developer to \`/clear\`, then run \`${supervision.rejoinCommand}\`.`;
  if (!isTicketOwed) return `${oneHandoffOf(supervisionHandoff)} ${clearLine}`;
  return (
    "two handoffs are your next and last steps, the ticket's first. " +
    `The ticket's${ticketHandoffOf(options)} The supervision's${supervisionHandoff} ${clearLine}`
  );
}

function oneHandoffOf(handoff: string): string {
  return `the handoff is your next and last step${handoff}`;
}

function ticketHandoffOf({
  sessionId,
  handoffDocPath,
}: ContextNudgeOptions): string {
  const handoffRule =
    handoffDocPath === undefined ? "" : `, per ${handoffDocPath}`;
  return (
    `${handoffRule}: an issue comment, or a file if there is no issue. ` +
    "If tsc, tests or lint are red, the handoff lists the changed files and what still fails (tsc errors, test names), " +
    "so the next session resumes from the working tree. Leave the work uncommitted. " +
    `End the handoff comment with \`session: ${sessionId}\`.`
  );
}

function supervisionHandoffOf({
  path,
  rejoinCommand,
}: SupervisionHandoff): string {
  return (
    `write \`${path}\`. It opens with the \`${rejoinCommand}\` line, then holds only what this conversation knows and the disk doesn't: ` +
    "suggested replies the developer hasn't settled, standing instructions the developer gave in chat, " +
    "and work in progress such as an Interactive ticket's workspace or a blocked edit underway; " +
    "no event history or run summary, since `supervise` and `status` carry those."
  );
}
