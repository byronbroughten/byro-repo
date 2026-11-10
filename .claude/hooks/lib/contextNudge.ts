// The context nudge's root-only parts: which sessions the ticket budget binds and the handoffs each owes, and the knobs the shim passes the runner's nudge. Pure apart from reading the override file; contextNudge.ts does the I/O.
import { join } from "node:path";

import type {
  ContextNudgeKnobs,
  OwedHandoffs,
} from "@byronbroughten/spec-runner/contextNudge";
import {
  type IssueRef,
  type LeasedWorkspace,
  workspaceKey,
} from "@byronbroughten/spec-runner/IssueWorkspaces";
import { runKnobsOrDefaults } from "@byronbroughten/spec-runner/runKnobs";
import type { SupervisionRecord } from "@byronbroughten/spec-runner/SupervisionRecords";

import { rejoinCommandOf } from "./sessionRecord.ts";
import type { SessionMode } from "./tiers/tiers.ts";

const runnerConfigPath = join(
  import.meta.dirname,
  "../../../scripts/runner/runner.config.json",
);

export interface BudgetedSession {
  mode: SessionMode;
  held: LeasedWorkspace[];
  // The supervision record on the session's claude ancestor, if any.
  record: SupervisionRecord | undefined;
}

// The budget sizes tickets and supervisions, so it binds ticket work or a Supervisor; other sessions are the operator's to pace.
export function owedHandoffsOf(
  session: BudgetedSession,
  handoffPathOf: (lead: IssueRef) => string,
): OwedHandoffs | undefined {
  const isTicketOwed = isTicketWork(session);
  const record = supervisedOf(session);
  if (record === undefined) {
    if (!isTicketOwed) return undefined;
    return { isTicketOwed };
  }
  const [lead] = record.members;
  const supervision = {
    path: handoffPathOf(lead),
    rejoinCommand: rejoinCommandOf(record),
  };
  return { isTicketOwed, supervision };
}

// A runner step, or a session holding an issue workspace.
function isTicketWork({ mode, held }: BudgetedSession): boolean {
  return (
    mode === "runnerStep" ||
    held.some(({ key }) => !workspaceKey.isSession(key))
  );
}

// A runner step is never a Supervisor, and an ended supervision no longer makes its session one.
function supervisedOf({
  mode,
  record,
}: BudgetedSession): SupervisionRecord | undefined {
  if (mode === "runnerStep" || record?.endedBy !== undefined) return undefined;
  return record;
}

export function contextNudgeKnobs(): ContextNudgeKnobs {
  const { ticketBudget, handoffDocPath } = runKnobsOrDefaults(runnerConfigPath);
  return { ticketBudget, handoffDocPath };
}
