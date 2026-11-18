// Writes a ticket's outcome row to the primary root's gitignored outcome folder, with the merged root checkout's code and
// no commit, unless the ticket is a human one.

import { type WrapUpFacts } from "../FactsFile.ts";
import { type IssueRef, issueRef, type Workspace } from "../IssueWorkspaces.ts";
import { estimateOf } from "../modelFit.ts";
import { writeOutcomeRow } from "../outcomeRowWriter.ts";
import { rowWorkflowNameOf, type WorkflowName } from "../Workflow.ts";
import { IssueCloser } from "./IssueCloser.ts";
import { WrapUpBase } from "./WrapUpBase.ts";
import { labels, type Landing } from "./wrapUpTypes.ts";

export interface LogRowTarget {
  issue: IssueRef;
  facts: WrapUpFacts;
  landing: Landing;
  workspace: Workspace;
}

export class LogRowWriter extends WrapUpBase {
  private get closer(): IssueCloser {
    return new IssueCloser(this.config);
  }

  // A ready-for-human ticket ran no agent session, so its row would be nearly all unrecorded.
  async _logRow(target: LogRowTarget): Promise<void> {
    await this._step(target.landing, "log-row", async () => {
      if (await this._isHumanTicket(target.issue)) return;
      await this._writeLogRow(target);
    });
  }

  private async _isHumanTicket(issue: IssueRef): Promise<boolean> {
    const issueLabels = await this._labelsOf(issue);
    return issueLabels.includes(labels.human);
  }

  // From the labels, so a ticket landed outside a run, which has no run to record it, gets its row's Workflow.
  private async _workflowOf(
    issue: IssueRef,
    spec: IssueRef,
  ): Promise<WorkflowName> {
    return rowWorkflowNameOf({
      ticket: { issue, labels: await this._labelsOf(issue) },
      spec: { labels: await this._labelsOf(spec) },
    });
  }

  private async _labelsOf(issue: IssueRef): Promise<string[]> {
    return this._withRetries(
      `Reading ${issueRef.labelOf(issue)}'s labels`,
      () => this.config.github.labelsOf(issue),
    );
  }

  // A rerun writes the same path again, so a landing leaves one row however often it ran.
  private async _writeLogRow({
    issue,
    facts,
    landing,
    workspace,
  }: LogRowTarget): Promise<void> {
    const worktree = this._worktreeOf(workspace, this._rootRepo);
    let handoffSessionIds: string[] = [];
    if (facts.sessions !== undefined) {
      handoffSessionIds = await this.closer._handoffSessionIdsOf(issue);
    }
    const spec = await this.closer._specOf(issue);
    const writeRow = this.config.writeOutcomeRow ?? writeOutcomeRow;
    await writeRow(worktree, {
      issue,
      spec,
      workflow: await this._workflowOf(issue, spec),
      githubOwner: this.config.githubOwner,
      filesChanged: landing.progress.filesChanged ?? 0,
      estimate: estimateOf(await this._bodyOf(issue)),
      handoffSessionIds,
      silenceTimeoutMs: this.knobs.silenceTimeoutMs,
      stateFolder: this.config.stateFolder,
      outcomeFolder: this.config.outcomeFolder,
    });
  }
}
