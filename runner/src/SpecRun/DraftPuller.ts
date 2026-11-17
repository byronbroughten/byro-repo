// A piece spec's drafting ticket's pull Step: writes the Agent draft its spec's Workflow pulls from the Deliverable's Doc
// into the spec's repo in the ticket's workspace, promoting that repo onto the ticket's branch first, commits it there,
// and keeps the Doc's text it saw on the ticket's state as the push baseline. The pull rules are the Workflow's, through
// ../Workflow.ts; the pull itself is runState/draftPull.ts, which `npm run piece:pull` shares; TicketSequencer.ts runs it as a Step.

import { issueRef } from "../IssueWorkspaces.ts";
import { UnhandledStop } from "../UnhandledStop.ts";
import { pullOf } from "../Workflow.ts";
import type { TicketRun } from "./runState.ts";
import type { DraftFile } from "./runState/draftCommits.ts";
import { draftPull } from "./runState/draftPull.ts";
import { SpecRunBase } from "./SpecRunBase.ts";

export class DraftPuller extends SpecRunBase {
  async _pull(ticketRun: TicketRun): Promise<void> {
    const { run, ticket, state } = ticketRun;
    const rules = pullOf(this._ticketWorkflowOf({ ticket, spec: run.spec }));
    const documentId = rules.deliverableOf(run.spec);
    if (documentId === undefined) {
      throw new UnhandledStop(
        "step-error",
        draftPull.noDeliverableOf({
          spec: run.spec.issue,
          ticket: ticket.issue,
        }),
        this._progressPathOf(run),
      );
    }
    const clone = await this._specCloneOf(ticketRun);
    const { pulled, file } = await draftPull.written({
      rules,
      spec: run.spec.issue,
      documentId,
      clone,
    });
    state.pullBaseline = pulled.baseline;
    this._saveState(run);
    await this._commitDraft(ticketRun, file);
  }

  private async _specCloneOf(ticketRun: TicketRun): Promise<string> {
    const { repo } = ticketRun.run.spec.issue;
    const clone = this._cloneIn(ticketRun.workspace, repo);
    ticketRun.workspace = await draftPull.promotedOf(
      this.workspaces,
      ticketRun.workspace,
      repo,
    );
    return clone;
  }

  private async _commitDraft(
    { run, ticket }: TicketRun,
    file: DraftFile,
  ): Promise<void> {
    const label = issueRef.labelOf(ticket.issue);
    const isCommitted = await draftPull.commit(file, {
      spec: run.spec.issue,
      ticket: ticket.issue,
    });
    if (!isCommitted) {
      this._log(run, `${label}: the Agent draft already matches the Doc.`);
      return;
    }
    this._log(run, `${label}: pulled the Deliverable into the Agent draft.`);
  }
}
