// Decides the lease release: whether a session end ends its claude process, and which workspaces' leases that process holds. Pure; leaseRelease.ts does the I/O.
import {
  isSameHolder,
  type LeasedWorkspace,
  type LeaseHolder,
} from "@byronbroughten/spec-runner/IssueWorkspaces";

// SessionEnd reasons after which the same claude process carries on working in its workspace, or supervising its run.
const processContinuingReasons = new Set(["clear", "resume"]);

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
