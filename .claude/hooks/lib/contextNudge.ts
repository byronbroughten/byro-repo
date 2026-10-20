// The context nudge's root-only parts: which sessions the ticket budget binds, and the knobs the shim passes the runner's nudge. Pure apart from reading the override file; contextNudge.ts does the I/O.
import { join } from "node:path";

import {
  isSessionKey,
  type LeasedWorkspace,
} from "@byronbroughten/spec-runner/IssueWorkspaces";
import {
  type RunKnobs,
  runKnobsOrDefaults,
} from "@byronbroughten/spec-runner/runKnobs";

import type { SessionMode } from "./tiers.ts";

const runnerConfigPath = join(
  import.meta.dirname,
  "../../../scripts/runner/runner.config.json",
);

// The budget sizes tickets, so it binds a runner step or a session holding an issue workspace; other sessions are the operator's to pace.
export function isTicketWork(
  mode: SessionMode,
  held: LeasedWorkspace[],
): boolean {
  return mode === "runnerStep" || held.some(({ key }) => !isSessionKey(key));
}

export function contextNudgeKnobs(): Pick<
  RunKnobs,
  "ticketBudget" | "handoffDocPath"
> {
  const { ticketBudget, handoffDocPath } = runKnobsOrDefaults(runnerConfigPath);
  return { ticketBudget, handoffDocPath };
}
