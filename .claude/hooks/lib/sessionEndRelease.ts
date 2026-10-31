// Decides what a session end lets go of: its supervision always, and its claude process's workspace leases when that process ends too. Pure; sessionEndRelease.ts does the I/O.
import {
  isSameHolder,
  type LeasedWorkspace,
  type LeaseHolder,
} from "@byronbroughten/spec-runner/IssueWorkspaces";
import type { SupervisionEnd } from "@byronbroughten/spec-runner/SupervisionRecords";

export interface SessionEndRelease {
  // Kept in the supervision record, so SessionStart can say how the supervision ended.
  endedBy: SupervisionEnd;
  isLeaseReleased: boolean;
}

// A conversation after /clear is about something else, so it must run /runner before it hears a run's events again.
export function sessionEndReleaseOf(
  reason: string | undefined,
): SessionEndRelease {
  // After these, the same claude process carries on working in its workspace.
  if (reason === "clear" || reason === "resume") {
    return { endedBy: reason, isLeaseReleased: false };
  }
  return { endedBy: "processEnd", isLeaseReleased: true };
}

export function leasedWorkspacesOf(
  leased: LeasedWorkspace[],
  holder: LeaseHolder,
): LeasedWorkspace[] {
  return leased.filter(
    ({ lease }) => lease.isLive && isSameHolder(lease, holder),
  );
}
