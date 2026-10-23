// Decides the lease release: whether a session end ends its claude process, and which workspaces' leases that process holds.
// Pure but for the supervision record's release, whose records come in; leaseRelease.ts does the rest of the I/O.
import {
  isSameHolder,
  type LeasedWorkspace,
  type LeaseHolder,
} from "@byronbroughten/spec-runner/IssueWorkspaces";
import type { SupervisionRecords } from "@byronbroughten/spec-runner/SupervisionRecords";

// SessionEnd reasons after which the same claude process carries on working in its workspace.
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

// Kept on the same ends as a lease, so a cleared session carries on supervising.
export async function releaseSupervisionAtEnd(
  records: SupervisionRecords,
  holder: LeaseHolder,
  reason: string | undefined,
): Promise<void> {
  if (endsProcess(reason)) await records.release(holder);
}
