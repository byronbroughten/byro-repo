// The run's workspace leases: takes a ticket's lease as the run, releasing only the run's own, and finds or creates
// the ticket's issue workspace, resuming an existing one. A lease another live holder has leaves the ticket waiting.
// ../SpecRun.ts calls _otherHolderOf while it picks a ticket and _releaseLeaseOf after a session's review;
// TicketSequencer.ts calls _workspaceFor, _takeLease and _releaseLeaseOf around one ticket's run.
// It calls only the Base.

import { messageOf } from "../failureText.ts";
import {
  isSameHolder,
  issueLabelOf,
  type IssueRef,
  type LeaseHolder,
  otherLiveHolderOf,
  type Workspace,
} from "../IssueWorkspaces.ts";
import { LeaseHeld } from "../LeaseHeld.ts";
import { UnhandledStop } from "../UnhandledStop.ts";
import { type Run, runHolder } from "./runState.ts";
import { SpecRunBase } from "./SpecRunBase.ts";

export class LeaseKeeper extends SpecRunBase {
  async _otherHolderOf(issue: IssueRef): Promise<LeaseHolder | undefined> {
    const lease = (await this.workspaces.find(issue))?.lease;
    return otherLiveHolderOf(lease, runHolder);
  }

  async _releaseLeaseOf(issue: IssueRef): Promise<void> {
    const workspace = await this.workspaces.find(issue);
    if (workspace?.lease && isSameHolder(workspace.lease, runHolder)) {
      await this.workspaces.releaseLease(workspace);
    }
  }

  async _takeLease(run: Run, workspace: Workspace): Promise<void> {
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
