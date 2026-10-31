// Decides what a session end lets go of: its supervision always, and its claude process's workspace leases when that process ends too. Pure; sessionEndRelease.ts does the I/O.
import {
  isSameHolder,
  type LeasedWorkspace,
  type LeaseHolder,
} from "@byronbroughten/spec-runner/IssueWorkspaces";

// SessionEnd reasons after which the same claude process carries on working in its workspace.
const processContinuingReasons = new Set(["clear", "resume"]);

export interface SessionEndRelease {
  // The SessionEnd reason the supervision record keeps, so SessionStart can say how the supervision ended.
  endedBy: string;
  isLeaseReleased: boolean;
}

// A conversation after /clear is about something else, so it must run /runner before it hears a run's events again.
export function sessionEndReleaseOf(
  reason: string | undefined,
): SessionEndRelease {
  return { endedBy: reason ?? "other", isLeaseReleased: endsProcess(reason) };
}

export function endsProcess(reason: string | undefined): boolean {
  return reason === undefined || !processContinuingReasons.has(reason);
}

export function leasedWorkspacesOf(
  leased: LeasedWorkspace[],
  holder: LeaseHolder,
): LeasedWorkspace[] {
  return leased.filter(
    ({ lease }) => lease.isLive && isSameHolder(lease, holder),
  );
}
