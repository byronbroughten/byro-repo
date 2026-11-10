// The context nudge: once a session's peak context reaches the ticket budget, the handoff reminder it gets, worded for the handoffs it owes; a repo's hook does the I/O.
// Claude Code loads hooks only from a root's settings, so each repo registers its own PostToolUse shim on every tool.
// The shim reads the hook input, skips subagents, reads the transcript at `transcript_path`,
// passes `contextNudgeOf()` the session's id, the handoffs it owes and the `ticketBudget` and `handoffDocPath` knobs
// (through `runKnobsOrDefaults()` from the repo's override file), and writes any reminder as `additionalContext`.
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

export interface OwedHandoffs {
  isTicketOwed: boolean;
  supervision?: SupervisionHandoff;
}

export interface ContextNudgeOptions extends ContextNudgeKnobs {
  // Named in the message so the handoff comment's `session:` line ties it to this transcript.
  sessionId: string;
  owed: OwedHandoffs;
}

// Lets a shim skip reading what a session owes until the budget is passed.
export function isPastTicketBudget(
  transcript: string,
  ticketBudget: number,
): boolean {
  const size = ContextMeter.ofTranscript(transcript);
  return size !== undefined && size >= ticketBudget;
}

export function contextNudgeOf(
  transcript: string,
  options: ContextNudgeOptions,
): string | undefined {
  const { ticketBudget, owed } = options;
  const size = ContextMeter.ofTranscript(transcript);
  if (size === undefined || size < ticketBudget) return undefined;
  const { isTicketOwed, supervision } = owed;
  const ticketHandoff = ticketHandoffOf(options);
  if (supervision === undefined) {
    if (!isTicketOwed) return undefined;
    return (
      `${openingOf(size, `${ticketBudget / 1000}K ticket budget`)} ` +
      `Finish the step you are on; the handoff is your next and last step${ticketHandoff} ` +
      "Then recommend a fresh session to the developer."
    );
  }
  const opening = openingOf(size, `${ticketBudget / 1000}K context budget`);
  const supervisionHandoff = supervisionHandoffOf(supervision);
  const clearLine = `Then tell the developer to \`/clear\`, then run \`${supervision.rejoinCommand}\`.`;
  if (!isTicketOwed) {
    return `${opening} Finish the step you are on; the handoff is your next and last step: ${supervisionHandoff} ${clearLine}`;
  }
  return (
    `${opening} Finish the step you are on; two handoffs are your next and last steps, the ticket's first. ` +
    `The ticket's${ticketHandoff} The supervision's: ${supervisionHandoff} ${clearLine}`
  );
}

function openingOf(size: number, budget: string): string {
  return `Context nudge: this session's context is ${Math.round(size / 1000)}K tokens, past the ${budget}.`;
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
