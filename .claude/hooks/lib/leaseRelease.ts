// Which workspaces' leases an ending session releases. The hook is ../leaseRelease.ts.
import {
  isSameHolder,
  type LeaseHolder,
  type WorkspaceStatus,
} from "@byronbroughten/spec-runner/IssueWorkspaces";

export function leasedWorkspacesOf(
  workspaces: WorkspaceStatus[],
  holder: LeaseHolder,
): WorkspaceStatus[] {
  return workspaces.filter(
    ({ lease }) => lease !== undefined && isSameHolder(lease, holder),
  );
}
