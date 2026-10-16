// Decides the lease release: whether a session end ends its claude process, and which workspaces' leases that process holds. Pure; leaseRelease.ts does the I/O.
import {
  isSameHolder,
  type LeaseHolder,
  type WorkspaceStatus,
} from "@byronbroughten/spec-runner/IssueWorkspaces";

// SessionEnd reasons after which the same claude process carries on working in its workspace.
const processContinuingReasons = new Set(["clear", "resume"]);

export function endsProcess(reason: string | undefined): boolean {
  return reason === undefined || !processContinuingReasons.has(reason);
}

export function leasedWorkspacesOf(
  workspaces: WorkspaceStatus[],
  holder: LeaseHolder,
): WorkspaceStatus[] {
  return workspaces.filter(
    ({ lease }) => lease?.isLive === true && isSameHolder(lease, holder),
  );
}
