import {
  type IssueSource,
  type ReadableIssue,
  untrustedBodyReasonOf,
} from "./IssueReader.ts";
import {
  type IssueRef,
  issueRef,
  type IssueWorkspaces,
  type Workspace,
} from "./IssueWorkspaces.ts";
import { draftPull, type WrittenPull } from "./SpecRun/runState/draftPull.ts";
import {
  isDrafting,
  pickedWorkflowOf,
  pullOf,
  type PullRules,
  type Workflows,
} from "./Workflow.ts";

export interface PiecePullConfig {
  source: IssueSource;
  developer: string;
  workspaces: IssueWorkspaces;
  // The piece Workflow's Docs port here reads as the agent account, not the runner's clasp login.
  workflows: Workflows;
}

interface ReadTicket {
  ticket: ReadableIssue;
  spec: ReadableIssue;
}

interface Pull {
  rules: PullRules;
  spec: IssueRef;
  documentId: string;
  workspace: Workspace;
}

// `npm run piece:pull`'s core: a drafting ticket's pull, as the runner's pull Step (SpecRun/DraftPuller.ts) runs it, into
// the ticket's own issue workspace, committed there, then the Deliverable's ID and Section headings an interactive session
// needs next. Both share SpecRun/runState/draftPull.ts; this keeps no push baseline, since only a run pushes.
// Every refusal comes before the promote or any write. The script is scripts/runner/piecePull.ts.
export class PiecePull {
  private readonly config: PiecePullConfig;

  constructor(config: PiecePullConfig) {
    this.config = config;
  }

  static init(config: PiecePullConfig): PiecePull {
    return new PiecePull(config);
  }

  async pull(ticket: IssueRef): Promise<string> {
    const { rules, spec, documentId, workspace } = await this._pullOf(ticket);
    const { workspaces } = this.config;
    const promoted = await workspaces.promote(workspace, spec.repo);
    const clone = workspaces.worktreeOf(promoted, spec.repo);
    const written = await draftPull.written({
      rules,
      spec,
      documentId,
      clone,
    });
    const isCommitted = await draftPull.commit(written.file, { spec, ticket });
    return printedOf({ written, documentId, isCommitted, promoted });
  }

  private async _pullOf(ticket: IssueRef): Promise<Pull> {
    const read = await this._readOf(ticket);
    const rules = this._rulesOf(read);
    const spec = read.spec.issue;
    const reason = untrustedBodyReasonOf(this.config.developer, read.spec);
    if (reason !== undefined) {
      throw new Error(
        `${issueRef.labelOf(spec)}'s body is Untrusted text, ${reason}, so piece:pull won't read its Deliverable.`,
      );
    }
    const documentId = rules.deliverableOf(read.spec);
    if (documentId === undefined) {
      throw new Error(draftPull.noDeliverableOf({ spec, ticket }));
    }
    const workspace = await this.config.workspaces.find(ticket);
    if (workspace === undefined) {
      throw new Error(
        `${issueRef.labelOf(ticket)} has no issue workspace; open one with \`npm run issue:start -- ${ticket.repo} ${ticket.number}\` first.`,
      );
    }
    return { rules, spec, documentId, workspace };
  }

  // A ticket with no parent is its own spec.
  private async _readOf(issue: IssueRef): Promise<ReadTicket> {
    const { source } = this.config;
    const ticket = await source.readableIssueOf(issue);
    if (ticket.parent === undefined) return { ticket, spec: ticket };
    return { ticket, spec: await source.readableIssueOf(ticket.parent) };
  }

  private _rulesOf(read: ReadTicket): PullRules {
    const workflow = pickedWorkflowOf(read, this.config.workflows);
    const { labels } = read.ticket;
    const skill = workflow.sessionSkillOf(read.ticket);
    if (!isDrafting({ skill, labels })) {
      throw new Error(
        `${issueRef.labelOf(read.ticket.issue)} is not a drafting ticket, so piece:pull has nothing to pull.`,
      );
    }
    return pullOf(workflow);
  }
}

interface Printed {
  written: WrittenPull;
  documentId: string;
  isCommitted: boolean;
  promoted: Workspace;
}

function printedOf({
  written,
  documentId,
  isCommitted,
  promoted,
}: Printed): string {
  const { draftPath } = written.file;
  const { branch } = promoted;
  let commitLine = `Committed the Agent draft, ${draftPath}, on ${branch}.`;
  if (!isCommitted) {
    commitLine = `The Agent draft, ${draftPath}, already matches the Doc, so nothing was committed on ${branch}.`;
  }
  return [
    "piece:pull holds the Deliverable's Doc ID and each of its Section headings by heading path, as the Agent draft now holds them.",
    commitLine,
    `Deliverable: ${documentId}`,
    "Sections by heading path:",
    ...Object.keys(written.pulled.baseline.sections).map((path) => `- ${path}`),
  ].join("\n");
}
