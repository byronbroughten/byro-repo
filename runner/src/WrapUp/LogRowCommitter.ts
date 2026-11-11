// Writes a ticket's outcome row into the merged root checkout and commits it, unless the ticket is a human one.

import { type WrapUpFacts } from "../FactsFile.ts";
import { git, revOf } from "../git.ts";
import { type IssueRef, issueRef, type Workspace } from "../IssueWorkspaces.ts";
import { writeOutcomeRow } from "../outcomeRowWriter.ts";
import { type WorkflowName, workflowNameOf } from "../Workflow.ts";
import { IssueCloser } from "./IssueCloser.ts";
import { WrapUpBase } from "./WrapUpBase.ts";
import { labels, type Landing } from "./wrapUpTypes.ts";

export interface LogRowTarget {
  issue: IssueRef;
  facts: WrapUpFacts;
  landing: Landing;
  workspace: Workspace;
}

export class LogRowCommitter extends WrapUpBase {
  private get closer(): IssueCloser {
    return new IssueCloser(this.config);
  }

  // A ready-for-human ticket ran no agent session, so its row would be nearly all unrecorded.
  async _logRow(target: LogRowTarget): Promise<void> {
    await this._step(target.landing, "log-row", async () => {
      if (await this._isHumanTicket(target.issue)) return;
      await this._commitLogRow(target);
    });
  }

  private async _isHumanTicket(issue: IssueRef): Promise<boolean> {
    const issueLabels = await this._labelsOf(issue);
    return issueLabels.includes(labels.human);
  }

  // From the spec's labels, so a ticket landed outside a run, which has no run to record it, gets its row's Workflow.
  private async _workflowOf(spec: IssueRef): Promise<WorkflowName> {
    return workflowNameOf({ labels: await this._labelsOf(spec) });
  }

  private async _labelsOf(issue: IssueRef): Promise<string[]> {
    return this._withRetries(
      `Reading ${issueRef.labelOf(issue)}'s labels`,
      () => this.config.github.labelsOf(issue),
    );
  }

  private async _commitLogRow({
    issue,
    facts,
    landing,
    workspace,
  }: LogRowTarget): Promise<void> {
    const worktree = this._worktreeOf(workspace, this._rootRepo);
    const built = landing.progress.built ?? {};
    const base =
      built[this._rootRepo]?.base ?? (await revOf(worktree, "master"));
    let handoffSessionIds: string[] = [];
    if (facts.sessions !== undefined) {
      handoffSessionIds = await this.closer._handoffSessionIdsOf(issue);
    }
    const spec = await this.closer._specOf(issue);
    const writeRow = this.config.writeOutcomeRow ?? writeOutcomeRow;
    const { path, commitMessage } = await writeRow(worktree, {
      issue,
      spec,
      workflow: await this._workflowOf(spec),
      githubOwner: this.config.githubOwner,
      filesChanged: landing.progress.filesChanged ?? 0,
      handoffSessionIds,
      silenceTimeoutMs: this.knobs.silenceTimeoutMs,
      stateFolder: this.config.stateFolder,
      outcomeFolder: this.config.outcomeFolder,
    });
    await git(worktree, "add", path);
    // A rerun after a partial fast-forward finds the row already on master.
    if ((await git(worktree, "status", "--porcelain", path)) !== "") {
      await git(worktree, "commit", "-m", commitMessage);
    }
    built[this._rootRepo] = { base, head: await revOf(worktree, "HEAD") };
    landing.progress.built = built;
  }
}
