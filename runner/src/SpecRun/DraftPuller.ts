// A piece spec's drafting ticket's pull Step: writes the Agent draft its spec's Workflow pulls from the Deliverable's Doc
// into the spec's repo in the ticket's workspace, promoting that repo onto the ticket's branch first, commits it there,
// and keeps the Doc's text it saw on the ticket's state as the push baseline. The pull rules are the Workflow's, through
// ../Workflow.ts; TicketSequencer.ts runs it as a Step.

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

import { issueRef } from "../IssueWorkspaces.ts";
import { UnhandledStop } from "../UnhandledStop.ts";
import { pullOf } from "../Workflow.ts";
import type { TicketRun } from "./runState.ts";
import { draftCommits, type DraftFile } from "./runState/draftCommits.ts";
import { SpecRunBase } from "./SpecRunBase.ts";

export class DraftPuller extends SpecRunBase {
  async _pull(ticketRun: TicketRun): Promise<void> {
    const { run, ticket, state } = ticketRun;
    const rules = pullOf(this._workflowOf(run.spec));
    const documentId = rules.deliverableOf(run.spec);
    if (documentId === undefined) {
      throw new UnhandledStop(
        "step-error",
        `${issueRef.labelOf(run.spec.issue)}'s ## Deliverable section names no Doc ID, so ${issueRef.labelOf(ticket.issue)} has no Doc to pull.`,
        this._progressPathOf(run),
      );
    }
    const clone = await this._specCloneOf(ticketRun);
    const draftPath = rules.draftPathOf(run.spec.issue);
    const file = join(clone, draftPath);
    const pulled = await rules.pulledOf({
      documentId,
      draft: existsSync(file) ? readFileSync(file, "utf8") : undefined,
    });
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(file, pulled.draft);
    state.pullBaseline = pulled.baseline;
    this._saveState(run);
    await this._commitDraft(ticketRun, { clone, draftPath });
  }

  // The spec's repo is the ticket's own unless the ticket was filed elsewhere, so it may still sit detached at master.
  private async _specCloneOf(ticketRun: TicketRun): Promise<string> {
    const { repo } = ticketRun.run.spec.issue;
    const clone = this._cloneIn(ticketRun.workspace, repo);
    if (!ticketRun.workspace.branchedRepos.includes(repo)) {
      ticketRun.workspace = await this.workspaces.promote(
        ticketRun.workspace,
        repo,
      );
    }
    return clone;
  }

  // A pull that changed nothing commits nothing.
  private async _commitDraft(
    { run, ticket }: TicketRun,
    file: DraftFile,
  ): Promise<void> {
    const label = issueRef.labelOf(ticket.issue);
    const isCommitted = await draftCommits.commit(
      file,
      `Pull the Deliverable into the Agent draft of ${issueRef.labelOf(run.spec.issue)}, for #${ticket.issue.number}`,
    );
    if (!isCommitted) {
      this._log(run, `${label}: the Agent draft already matches the Doc.`);
      return;
    }
    this._log(run, `${label}: pulled the Deliverable into the Agent draft.`);
  }
}
