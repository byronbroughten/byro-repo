// `npm run issue:list`'s line for one workspace, and for a broken folder the command that clears it.
import {
  holderLabelOf,
  type Lease,
  type WorkspaceKey,
  workspaceLabelOf,
  type WorkspaceStatus,
} from "@byronbroughten/spec-runner/IssueWorkspaces";

export function workspaceLineOf(workspace: WorkspaceStatus): string {
  const { key, branch, branchedRepos, dirtyRepos, createdAt, path, lease } =
    workspace;
  if (workspace.isBroken) {
    return [
      workspaceLabelOf(key),
      `broken: clear it with ${removeCommandOf(key)}`,
      `age ${ageOf(createdAt)}`,
      path,
    ].join("  ");
  }
  const dirty =
    dirtyRepos.length === 0 ? "clean" : `dirty: ${dirtyRepos.join(", ")}`;
  return [
    workspaceLabelOf(key),
    branch,
    `on branch: ${branchedRepos.join(", ")}`,
    dirty,
    leaseLabelOf(lease),
    `age ${ageOf(createdAt)}`,
    path,
  ].join("  ");
}

function removeCommandOf(key: WorkspaceKey): string {
  if ("session" in key) {
    return `npm run issue:remove -- --session ${key.session}`;
  }
  return `npm run issue:remove -- ${key.repo} ${key.number}`;
}

function leaseLabelOf(lease: Lease | undefined): string {
  if (!lease) return "no lease";
  if (!lease.isLive) return `lease abandoned by ${holderLabelOf(lease)}`;
  return `leased by ${holderLabelOf(lease)}`;
}

function ageOf(createdAt: Date): string {
  const hours = Math.floor((Date.now() - createdAt.getTime()) / 3_600_000);
  if (hours < 24) return `${hours}h`;
  return `${Math.floor(hours / 24)}d ${hours % 24}h`;
}
