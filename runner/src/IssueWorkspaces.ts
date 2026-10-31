// The workspace module: creates, lists, promotes, resumes and removes workspaces, each a byro-repo worktree in the injected
// workspace folder with a worktree of every package clone inside it, so work never moves a primary checkout's branch.
// An issue workspace is keyed by an IssueRef; a session workspace by a SessionKey, with every repo on its session branch.
// A lease is a run's or session's hold on one workspace; a holder holds one at a time.
// This class only delegates: building and finding workspaces is IssueWorkspaces/WorkspaceBuilder.ts, leases IssueWorkspaces/WorkspaceLeaser.ts.
// Everything repo-specific comes in as IssueWorkspacesConfig; byro-repo's values live in scripts/runner/.

import { IssueWorkspacesBase } from "./IssueWorkspaces/IssueWorkspacesBase.ts";
import { WorkspaceBuilder } from "./IssueWorkspaces/WorkspaceBuilder.ts";
import { WorkspaceLeaser } from "./IssueWorkspaces/WorkspaceLeaser.ts";
import {
  type CreateOptions,
  type IssueRef,
  type IssueWorkspacesConfig,
  type Lease,
  type LeasedWorkspace,
  type LeaseHolder,
  type MaybeLeasedFolder,
  type RemoveOptions,
  type Workspace,
  type WorkspaceKey,
  type WorkspaceStatus,
} from "./IssueWorkspaces/workspaceTypes.ts";

export {
  type CreateOptions,
  fileStemOf,
  holderLabelOf,
  type IssueRef,
  issueLabelOf,
  issueOfFileStem,
  type IssueWorkspacesConfig,
  isSameHolder,
  isSameIssue,
  isSessionKey,
  type Lease,
  type LeasedWorkspace,
  type LeaseHolder,
  otherLiveHolderOf,
  type RemoveOptions,
  sessionBranchOf,
  type SessionKey,
  type Workspace,
  type WorkspaceKey,
  workspaceLabelOf,
  type WorkspaceStatus,
} from "./IssueWorkspaces/workspaceTypes.ts";

export class IssueWorkspaces extends IssueWorkspacesBase {
  static init(config: IssueWorkspacesConfig): IssueWorkspaces {
    return new IssueWorkspaces(config);
  }

  private get builder(): WorkspaceBuilder {
    return new WorkspaceBuilder(this.config);
  }

  private get leaser(): WorkspaceLeaser {
    return new WorkspaceLeaser(this.config);
  }

  create(key: WorkspaceKey, options?: CreateOptions): Promise<Workspace> {
    return this.builder.create(key, options);
  }

  start(key: WorkspaceKey, holder?: LeaseHolder): Promise<Workspace> {
    return this.builder.start(key, holder);
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
    return this.builder.masterSet(spec);
  }

  find(key: WorkspaceKey): Promise<WorkspaceStatus | undefined> {
    return this.builder.find(key);
  }

  leasedFolderOf(key: WorkspaceKey): Promise<MaybeLeasedFolder | undefined> {
    return this.leaser.leasedFolderOf(key);
  }

  list(): Promise<WorkspaceStatus[]> {
    return this.builder.list();
  }

  promote(workspace: Workspace, repo: string): Promise<Workspace> {
    return this.builder.promote(workspace, repo);
  }

  resume(workspace: Workspace): Promise<void> {
    return this.builder.resume(workspace);
  }

  remove(
    workspace: Pick<Workspace, "path">,
    options?: RemoveOptions,
  ): Promise<void> {
    return this.builder.remove(workspace, options);
  }
}
