// The workspace module: creates, lists, promotes, resumes and removes workspaces, each a byro-repo worktree in the injected
// workspace folder with a worktree of every package clone inside it, so work never moves a primary checkout's branch.
// An issue workspace is keyed by an IssueRef; a session workspace by a SessionKey, with every repo on its session branch.
// A lease is a run's or session's hold on one workspace; a holder holds one at a time.
// This class only delegates: the workspace lifecycle is IssueWorkspaces/WorkspaceKeeper.ts, leases IssueWorkspaces/WorkspaceLeaser.ts.
// Everything repo-specific comes in as IssueWorkspacesConfig; byro-repo's values live in scripts/runner/.

import { IssueWorkspacesBase } from "./IssueWorkspaces/IssueWorkspacesBase.ts";
import { WorkspaceKeeper } from "./IssueWorkspaces/WorkspaceKeeper.ts";
import { WorkspaceLeaser } from "./IssueWorkspaces/WorkspaceLeaser.ts";
import {
  type Lease,
  type LeaseHolder,
} from "./IssueWorkspaces/workspaceLeases.ts";
import {
  type CreatedWorkspace,
  type CreateOptions,
  type IssueRef,
  type IssueWorkspacesConfig,
  type LeasedWorkspace,
  type MaybeLeasedFolder,
  type RemoveOptions,
  type Workspace,
  type WorkspaceKey,
  type WorkspaceStatus,
} from "./IssueWorkspaces/workspaceTypes.ts";

export {
  type Lease,
  type LeaseHolder,
  leaseHolder,
} from "./IssueWorkspaces/workspaceLeases.ts";
export {
  type CreatedWorkspace,
  type CreateOptions,
  type IssueRef,
  issueRef,
  type IssueWorkspacesConfig,
  type LeasedWorkspace,
  otherIssueBranch,
  type RemoveOptions,
  type RepoBranch,
  type SessionKey,
  type Workspace,
  type WorkspaceKey,
  workspaceKey,
  type WorkspaceStatus,
} from "./IssueWorkspaces/workspaceTypes.ts";

export class IssueWorkspaces extends IssueWorkspacesBase {
  static init(config: IssueWorkspacesConfig): IssueWorkspaces {
    return new IssueWorkspaces(config);
  }

  private get keeper(): WorkspaceKeeper {
    return new WorkspaceKeeper(this.config);
  }

  private get leaser(): WorkspaceLeaser {
    return new WorkspaceLeaser(this.config);
  }

  create(
    key: WorkspaceKey,
    options?: CreateOptions,
  ): Promise<CreatedWorkspace> {
    return this.keeper.create(key, options);
  }

  start(key: WorkspaceKey, holder?: LeaseHolder): Promise<CreatedWorkspace> {
    return this.keeper.start(key, holder);
  }

  takeLease(
    workspace: Pick<Workspace, "path">,
    holder: LeaseHolder,
  ): Promise<void> {
    return this.leaser.takeLease(workspace, holder);
  }

  releaseOwnLease(
    workspace: Pick<Workspace, "path">,
    holder?: LeaseHolder,
  ): Promise<Lease | undefined> {
    return this.leaser.releaseOwnLease(workspace, holder);
  }

  releaseLease(workspace: Pick<Workspace, "path">): Promise<void> {
    return this.leaser.releaseLease(workspace);
  }

  leaseOf(workspace: Pick<Workspace, "path">): Promise<Lease | undefined> {
    return this.leaser.leaseOf(workspace);
  }

  leases(): Promise<LeasedWorkspace[]> {
    return this.leaser.leases();
  }

  masterSet(spec: IssueRef): Promise<string> {
    return this.keeper.masterSet(spec);
  }

  find(key: WorkspaceKey): Promise<WorkspaceStatus | undefined> {
    return this.keeper.find(key);
  }

  leasedFolderOf(key: WorkspaceKey): Promise<MaybeLeasedFolder | undefined> {
    return this.leaser.leasedFolderOf(key);
  }

  list(): Promise<WorkspaceStatus[]> {
    return this.keeper.list();
  }

  promote(workspace: Workspace, repo: string): Promise<Workspace> {
    return this.keeper.promote(workspace, repo);
  }

  resume(workspace: Workspace): Promise<void> {
    return this.keeper.resume(workspace);
  }

  remove(
    workspace: Pick<Workspace, "path">,
    options?: RemoveOptions,
  ): Promise<void> {
    return this.keeper.remove(workspace, options);
  }
}
