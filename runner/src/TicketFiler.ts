// `npm run issue:file`'s core: files a folder of ticket drafts in dependency order under a parent, sets their blocked-by
// edges, then reads each ticket back. The draft format and its refusals are ticketDrafts.ts's; the entry, which reads
// the folder and builds the `gh` port, is `scripts/runner/issueFile.ts`.

import { messageOf } from "./failureText.ts";
import type { IssueRef } from "./IssueWorkspaces.ts";
import type { RunGitHub } from "./SpecRun.ts";
import {
  type DraftFile,
  type TicketDraft,
  ticketDrafts,
} from "./ticketDrafts.ts";

export interface NewIssue {
  title: string;
  body: string;
  labels: string[];
}

// The run loop's port, with the writes filing needs.
export interface FilingGitHub extends Pick<
  RunGitHub,
  "issueOf" | "subIssuesOf" | "openBlockersOf" | "parentOf"
> {
  createIssue(repo: string, issue: NewIssue): Promise<IssueRef>;
  addSubIssue(parent: IssueRef, child: IssueRef): Promise<void>;
  addBlocker(issue: IssueRef, blocker: IssueRef): Promise<void>;
}

export interface FilingRequest {
  repo: string;
  // Left out, each ticket files standalone.
  parent?: number;
  files: DraftFile[];
}

export interface FilingReport {
  exitCode: 0 | 1;
  text: string;
}

interface FiledTicket {
  draft: TicketDraft;
  issue: IssueRef;
  blockers: IssueRef[];
}

interface Linking {
  filed: FiledTicket[];
  parent?: number;
  filedLines: string[];
}

interface DraftWrite {
  draft: TicketDraft;
  step: "creating" | "linking";
  // Each ticket filed before the failure, as `<file>: #<n>`.
  filedLines: string[];
}

export class TicketFiler {
  private readonly github: FilingGitHub;

  constructor(github: FilingGitHub) {
    this.github = github;
  }

  static init(github: FilingGitHub): TicketFiler {
    return new TicketFiler(github);
  }

  // Throws before any write on a draft that can't file, and on a failed write naming its draft and what filed before
  // it; a read-back mismatch exits nonzero naming each draft.
  async file({ repo, parent, files }: FilingRequest): Promise<FilingReport> {
    const drafts = ticketDrafts.draftsOf(files);
    const filingOrder = ticketDrafts.filingOrderOf(drafts);
    const issueOfDraft = new Map<number, IssueRef>();
    const filedLines: string[] = [];
    for (const draft of filingOrder) {
      const { title, body, labels } = draft;
      const issue = await namingDraft(
        { draft, step: "creating", filedLines },
        () => this.github.createIssue(repo, { title, body, labels }),
      );
      issueOfDraft.set(draft.number, issue);
      filedLines.push(filedLineOf(draft, issue));
    }
    const filed = drafts.map((draft) => ({
      draft,
      issue: issueRefOf(issueOfDraft, draft.number),
      blockers: draft.blockers.map((blocker) =>
        issueRefOf(issueOfDraft, blocker),
      ),
    }));
    await this._link({ filed, parent, filedLines });
    const mismatches = await this._mismatchesOf(filed, parent);
    if (mismatches.length > 0) {
      return { exitCode: 1, text: mismatches.join("\n") };
    }
    const lines = filed.map(({ draft, issue }) => filedLineOf(draft, issue));
    return { exitCode: 0, text: lines.join("\n") };
  }

  // Sub-issues in draft order, as GitHub lists a parent's in the order they were added.
  private async _link({ filed, parent, filedLines }: Linking): Promise<void> {
    for (const { draft, issue, blockers } of filed) {
      await namingDraft({ draft, step: "linking", filedLines }, async () => {
        if (parent !== undefined) {
          await this.github.addSubIssue(
            { repo: issue.repo, number: parent },
            issue,
          );
        }
        for (const blocker of blockers) {
          await this.github.addBlocker(issue, blocker);
        }
      });
    }
  }

  private async _mismatchesOf(
    filed: FiledTicket[],
    parent?: number,
  ): Promise<string[]> {
    const mismatches: string[] = [];
    for (const { draft, issue, blockers } of filed) {
      const expectedBlockers = blockers.map(({ number }) => number);
      const found = await this._readBack(issue);
      const name = `${draft.fileName} (#${issue.number})`;
      if (found.title !== draft.title) {
        mismatches.push(
          `${name}: title reads back as ${JSON.stringify(found.title)}, not ${JSON.stringify(draft.title)}.`,
        );
      }
      if (!isSameSet(found.labels, draft.labels)) {
        mismatches.push(
          `${name}: labels read back as ${listText(found.labels)}, not ${listText(draft.labels)}.`,
        );
      }
      if (found.parent !== parent) {
        mismatches.push(
          `${name}: parent reads back as ${issueText(found.parent)}, not ${issueText(parent)}.`,
        );
      }
      if (!isSameSet(found.blockers, expectedBlockers)) {
        mismatches.push(
          `${name}: blocked by ${issuesText(found.blockers)} on read-back, not ${issuesText(expectedBlockers)}.`,
        );
      }
    }
    if (parent !== undefined) {
      mismatches.push(...(await this._orderMismatchesOf(filed, parent)));
    }
    return mismatches;
  }

  private async _readBack(issue: IssueRef): Promise<{
    title: string;
    labels: string[];
    parent?: number;
    blockers: number[];
  }> {
    const { title, labels } = await this.github.issueOf(issue);
    const parent = await this.github.parentOf(issue);
    const blockers = await this.github.openBlockersOf(issue);
    return {
      title,
      labels,
      parent: parent?.issue.number,
      blockers: blockers.map(({ number }) => number),
    };
  }

  // Names the first draft out of place among the parent's sub-issues.
  private async _orderMismatchesOf(
    filed: FiledTicket[],
    parent: number,
  ): Promise<string[]> {
    const [first] = filed;
    if (first === undefined) return [];
    const filedNumbers = new Set(filed.map(({ issue }) => issue.number));
    const listed = (
      await this.github.subIssuesOf({ repo: first.issue.repo, number: parent })
    ).flatMap(({ number }) => (filedNumbers.has(number) ? [number] : []));
    const outOfPlace = filed.find(
      ({ issue }, at) => listed[at] !== issue.number,
    );
    if (outOfPlace === undefined) return [];
    return [
      `${outOfPlace.draft.fileName} (#${outOfPlace.issue.number}): #${parent} lists its sub-issues as ${issuesText(listed)}, not in draft order.`,
    ];
  }
}

// A gh call failing partway leaves the tickets before it filed, so its error names the draft and lists them.
async function namingDraft<WT>(
  { draft, step, filedLines }: DraftWrite,
  write: () => Promise<WT>,
): Promise<WT> {
  try {
    return await write();
  } catch (error) {
    throw new Error(
      `${draft.fileName}: filing stopped ${step} its ticket: ${messageOf(error)} Filed so far, to fix by hand: ${listText(filedLines)}.`,
      { cause: error },
    );
  }
}

function filedLineOf(draft: TicketDraft, issue: IssueRef): string {
  return `${draft.fileName}: #${issue.number}`;
}

function issueRefOf(
  issueOfDraft: Map<number, IssueRef>,
  draft: number,
): IssueRef {
  const issue = issueOfDraft.get(draft);
  if (issue === undefined) throw new Error(`Draft ${draft} wasn't filed.`);
  return issue;
}

function isSameSet(
  found: (string | number)[],
  expected: (string | number)[],
): boolean {
  const foundSet = new Set(found);
  return (
    foundSet.size === new Set(expected).size &&
    expected.every((item) => foundSet.has(item))
  );
}

function listText(items: string[]): string {
  return items.length === 0 ? "none" : items.join(", ");
}

function issueText(number?: number): string {
  return number === undefined ? "none" : `#${number}`;
}

function issuesText(numbers: number[]): string {
  return listText(numbers.map((number) => `#${number}`));
}
