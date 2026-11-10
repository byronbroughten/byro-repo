// A piece spec's drafting ticket's pull Step: writes the Agent draft its spec's Workflow pulls from the Deliverable's Doc
// into the spec's repo in the ticket's workspace, promoting that repo onto the ticket's branch first, commits it there,
// and keeps the Doc's text it saw on the ticket's state as the push baseline. The pull rules are the Workflow's, through
// ../Workflow.ts; TicketSequencer.ts runs it as a Step.

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

import { git } from "../git.ts";
import { issueRef } from "../IssueWorkspaces.ts";
import { UnhandledStop } from "../UnhandledStop.ts";
import { pullOf } from "../Workflow.ts";
import type { TicketRun } from "./runState.ts";
import { SpecRunBase } from "./SpecRunBase.ts";

// The spec's clone in the workspace, and the Agent draft's path from its root.
interface DraftFile {
  clone: string;
  draftPath: string;
}

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
    const clonePath = this.config.knobs.clonePaths[repo];
    if (clonePath === undefined) {
      throw new Error(`The repo map has no clone of ${repo}.`);
    }
    if (!ticketRun.workspace.branchedRepos.includes(repo)) {
      ticketRun.workspace = await this.workspaces.promote(
        ticketRun.workspace,
        repo,
      );
    }
    return join(ticketRun.workspace.path, clonePath);
  }

  // A pull that changed nothing commits nothing.
  private async _commitDraft(
    { run, ticket }: TicketRun,
    { clone, draftPath }: DraftFile,
  ): Promise<void> {
    const label = issueRef.labelOf(ticket.issue);
    await git(clone, "add", "--", draftPath);
    const staged = await git(clone, "diff", "--cached", "--name-only");
    if (staged.trim() === "") {
      this._log(run, `${label}: the Agent draft already matches the Doc.`);
      return;
    }
    await git(
      clone,
      "commit",
      "-m",
      `Pull the Deliverable into the Agent draft of ${issueRef.labelOf(run.spec.issue)}, for #${ticket.issue.number}`,
    );
    this._log(run, `${label}: pulled the Deliverable into the Agent draft.`);
  }
}
