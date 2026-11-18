// `npm run issue:ready`'s core: puts one `ready-*` label on an issue in place of any triage label it holds, after the
// check issue:file shares, ticketReadiness.ts's. The entry, which builds the `gh` port, is `scripts/runner/issueReady.ts`.

import type { IssueRef } from "./IssueWorkspaces.ts";
import type { RunGitHub } from "./SpecRun.ts";
import { heldLabel } from "./SpecRun/runState.ts";
import { ticketReadiness } from "./ticketReadiness.ts";
import { workflowLabels } from "./Workflow.ts";

export interface LabelEdit {
  add: string[];
  remove: string[];
}

// The run loop's port, with the label write readying needs.
export interface ReadyingGitHub extends Pick<
  RunGitHub,
  "issueOf" | "parentOf"
> {
  editLabels(issue: IssueRef, edit: LabelEdit): Promise<void>;
}

export interface ReadyRequest {
  issue: IssueRef;
  label: string;
}

const triageLabels = new Set([heldLabel, ...ticketReadiness.readyLabels]);

export class TicketReadier {
  private readonly github: ReadyingGitHub;

  constructor(github: ReadyingGitHub) {
    this.github = github;
  }

  static init(github: ReadyingGitHub): TicketReadier {
    return new TicketReadier(github);
  }

  // Throws, changing no label, on a label that isn't a `ready-*` one and on a body the check refuses; returns the line to print.
  async ready({ issue, label }: ReadyRequest): Promise<string> {
    if (!ticketReadiness.readyLabels.includes(label)) {
      throw new Error(
        `${label} isn't a ready label, which is one of ${ticketReadiness.readyLabels.join(", ")}.`,
      );
    }
    const { body, labels } = await this.github.issueOf(issue);
    if (
      ticketReadiness.isChecked(label) &&
      !(await this._isSpecHeadedForTickets(issue, labels, body))
    ) {
      const gaps = ticketReadiness.gapsOf(body);
      if (gaps.length > 0) {
        throw new Error(
          `Relabelling nothing: #${issue.number} ${gaps.join(", and ")}, by docs/agents/tickets.md.`,
        );
      }
    }
    await this.github.editLabels(issue, {
      add: [label],
      remove: labels.filter((held) => triageLabels.has(held) && held !== label),
    });
    return `#${issue.number}: ${label}`;
  }

  // A spec implemented as one ticket carries a Model fit, so it is checked like any ticket.
  private async _isSpecHeadedForTickets(
    issue: IssueRef,
    labels: string[],
    body: string,
  ): Promise<boolean> {
    const isSpec = Object.values(workflowLabels).some((workflow) =>
      labels.includes(workflow),
    );
    if (!isSpec || ticketReadiness.hasModelFit(body)) return false;
    return (await this.github.parentOf(issue)) === undefined;
  }
}
