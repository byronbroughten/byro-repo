// The run's workspace leases: takes a ticket's lease as the run, releasing only the run's own, and finds or creates
// the ticket's issue workspace, resuming an existing one. A lease another live holder has leaves the ticket waiting.
// TicketSelector.ts calls _otherHolderOf while it picks a ticket, SessionReviewer.ts _takeSessionLease and _releaseLeaseOf
// around a session's review; TicketSequencer.ts calls _workspaceFor, _takeLease and _releaseLeaseOf around one ticket's run.
// It calls only the Base.

import { messageOf } from "../failureText.ts";
import {
  isSameHolder,
  issueLabelOf,
  type IssueRef,
  type LeaseHolder,
  otherLiveHolderOf,
  type Workspace,
  type WorkspaceStatus,
} from "../IssueWorkspaces.ts";
import { LeaseHeld } from "../LeaseHeld.ts";
import { UnhandledStop } from "../UnhandledStop.ts";
import { type Run } from "./runState.ts";
import { SpecRunBase } from "./SpecRunBase.ts";

const runHolder: LeaseHolder = { kind: "run", pid: process.pid };

export class LeaseKeeper extends SpecRunBase {
  async _otherHolderOf(issue: IssueRef): Promise<LeaseHolder | undefined> {
    const folder = await this.workspaces.leasedFolderOf(issue);
    return otherLiveHolderOf(folder?.lease, runHolder);
  }

  async _releaseLeaseOf(issue: IssueRef): Promise<void> {
    const folder = await this.workspaces.leasedFolderOf(issue);
    if (folder?.lease && isSameHolder(folder.lease, runHolder)) {
      await this.workspaces.releaseLease(folder);
    }
  }

  async _takeLease(
    run: Run,
    workspace: Pick<Workspace, "path">,
  ): Promise<void> {
    try {
      await this.workspaces.takeLease(workspace, runHolder);
    } catch (error) {
      if (error instanceof LeaseHeld) throw error;
      throw new UnhandledStop(
        "workspace",
        messageOf(error),
        this._progressPathOf(run),
      );
    }
  }

  // Past the refusals, a live lease is the caller's own.
  async _takeSessionLease(workspace: WorkspaceStatus): Promise<void> {
    if (otherLiveHolderOf(workspace.lease) === undefined) {
      await this.workspaces.takeLease(workspace, runHolder);
    }
  }

  async _workspaceFor(run: Run, issue: IssueRef): Promise<Workspace> {
    const existing = await this.workspaces.find(issue);
    if (!existing) {
      const created = await this.workspaces.create(issue);
      await this._takeLease(run, created);
      return created;
    }
    await this._takeLease(run, existing);
    try {
      await this.workspaces.resume(existing);
    } catch (error) {
      throw new UnhandledStop(
        "workspace",
        messageOf(error),
        this._progressPathOf(run),
      );
    }
    this._log(run, `${issueLabelOf(issue)}: resumed ${existing.path}.`);
    return existing;
  }
}
