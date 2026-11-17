import {
  briefBodyOf,
  briefHeadlineOf,
  listOf,
  othersCommentsLineOf,
  overflowMessageOf,
  type ReadableIssue,
  refLabelOf,
  stateWordOf,
} from "../IssueReader.ts";
import { type IssueRef, issueRef } from "../IssueWorkspaces.ts";
import { type UndecidedCount, undecidedTextOf } from "../reviewList.ts";
import { type ParentCheck } from "../WrapUp/wrapUpTypes.ts";
import { closeOutLabels, closeOutWords } from "./closeOutWords.ts";

const { command } = closeOutWords;

// One step of the chain a close would make ready: a closing issue and its parent check once it closes.
export interface ParentLink {
  child: IssueRef;
  check: ParentCheck;
}

export interface ReadParent {
  parent: ReadableIssue;
  // The sub-issues in the repo map, in GitHub's order; the reader reads no other repo.
  children: ReadableIssue[];
  undecided: UndecidedCount;
  hasGapCheck: boolean;
  // From the parent up, each open one taken as closed, ending at the first check that isn't ready to close.
  chain: ParentLink[];
}

export interface CloseOutWriterConfig {
  read: ReadParent;
  developer: string;
  githubOwner: string;
}

// What keeps the parent from closing: its sub-issues still open or unread, and its undecided review-list items.
export interface Refusals {
  openSubIssues: IssueRef[];
  undecided: UndecidedCount | undefined;
}

// Words a read parent's Close-out brief and refusals, printing only Trusted text and counting the rest with the command that reads it.
export class CloseOutWriter {
  private readonly config: CloseOutWriterConfig;

  constructor(config: CloseOutWriterConfig) {
    this.config = config;
  }

  // Undefined `editGate` means none is open.
  briefOf(editGate: ReadableIssue | undefined): string[] {
    const { parent } = this.config.read;
    return [
      `${command} brief of ${issueRef.labelOf(parent.issue)}: its body, each sub-issue's title, state and closing comment, the undecided review-list count, the gap check, the piece ticket and its parent check with the chain above it. It holds all of them; don't read them again.`,
      "",
      `# Parent ${briefHeadlineOf(this.config.developer, parent)}`,
      `State: ${stateWordOf(parent.isOpen)}`,
      `Labels: ${listOf(parent.labels)}`,
      "",
      ...briefBodyOf(this.config.developer, "## Parent body", parent),
      "",
      "## Sub-issues",
      ...this._subIssuesOf(),
      "",
      `## Review list: ${undecidedTextOf(this.config.read.undecided)}`,
      "",
      `## Gap check: ${this._gapCheckOf()}`,
      "",
      `## Piece ticket: ${this._pieceTicketOf()}`,
      ...this._editGateOf(editGate),
      "",
      ...this._chainOf(`once ${this._refOf(parent.issue)} closes`),
    ];
  }

  // Waits for the Arrive operation, so no other refusal or brief applies.
  mapRefusalOf(): string {
    const label = issueRef.labelOf(this.config.read.parent.issue);
    return `${command} brief of ${label}: refused, ${label} is a ${closeOutLabels.map}, which closes only by the issue tracker doc's Arrive operation: the session that delivers the map's destination closes it on arrival.`;
  }

  refusalOf({ openSubIssues, undecided }: Refusals): string[] {
    const { parent } = this.config.read;
    const label = issueRef.labelOf(parent.issue);
    const lines = [
      `${command} brief of ${label}: refused, so it holds only why and what to run${openSubIssues.length > 0 ? ", then the parent check and the chain above it once its open sub-issues close" : ""}.`,
      "",
    ];
    if (undecided !== undefined) {
      lines.push(
        `- Its review list has ${undecidedTextOf(undecided)} items: run \`/judge-findings ${parent.issue.repo} ${parent.issue.number}\` first.`,
      );
    }
    if (openSubIssues.length === 0) return lines;
    const open = openSubIssues.map((sub) => this._refOf(sub)).join(", ");
    return [
      ...lines,
      `- Open sub-issues: ${open}; each closes first.`,
      "",
      ...this._chainOf(`once ${open} and ${this._refOf(parent.issue)} close`),
    ];
  }

  // After the close, so the check counts the parent as closed.
  closedOf(path: string, check: ParentCheck): string[] {
    const { parent } = this.config.read;
    return [
      `${closeOutWords.closedOf(parent.issue, path)}, then read its parent check.`,
      "",
      this._checkLineOf({ child: parent.issue, check }),
    ];
  }

  closedWithoutCheckOf(path: string, reason: string): string {
    const { parent } = this.config.read;
    return `${closeOutWords.closedOf(parent.issue, path)}, but reading its parent check failed: ${reason}`;
  }

  private _subIssuesOf(): string[] {
    const { parent, children } = this.config.read;
    if (parent.subIssues.length === 0) return ["", "None."];
    return parent.subIssues.flatMap((ref) => {
      const child = children.find(({ issue }) => issueRef.isSame(issue, ref));
      if (child === undefined) {
        return [
          "",
          `### ${this._refOf(ref)}: not read, its repo is outside the repo map`,
        ];
      }
      return ["", ...this._subIssueOf(child)];
    });
  }

  private _subIssueOf(child: ReadableIssue): string[] {
    const { developer } = this.config;
    const heading = `### ${briefHeadlineOf(developer, child)}: ${stateWordOf(child.isOpen)}`;
    const others = child.comments.filter(({ author }) => author !== developer);
    const othersLine =
      others.length === 0
        ? []
        : ["", othersCommentsLineOf(child.issue, others.length)];
    return [heading, "", ...this._closingCommentOf(child), ...othersLine];
  }

  // The closing comment is the developer's last, the runner posting as the developer's login.
  private _closingCommentOf(child: ReadableIssue): string[] {
    if (child.isOpen) return ["Closing comment: none, it is open"];
    if (child.hasUnreadComments) {
      return [
        `Closing comment: not read, ${overflowMessageOf(child.issue, "comments")}`,
      ];
    }
    const { developer } = this.config;
    const last = child.comments.findLast(({ author }) => author === developer);
    if (last === undefined) return [`Closing comment: none by ${developer}`];
    return ["Closing comment (Trusted text):", "", last.body];
  }

  private _gapCheckOf(): string {
    const label = this._refOf(this.config.read.parent.issue);
    if (this.config.read.hasGapCheck) {
      return `a run's gap check (\`ticket=gap-check\`) is on ${label}, so the Close-out runs none`;
    }
    return `no run's gap check (\`ticket=gap-check\`) is on ${label}, so the Close-out runs its own`;
  }

  private _pieceTicketOf(): string {
    const pieces = this.config.read.children.filter(({ labels }) =>
      labels.includes(closeOutLabels.piece),
    );
    return closeOutWords.pieceTicketOf(
      pieces.map(({ issue }) => this._refOf(issue)),
    );
  }

  private _editGateOf(editGate: ReadableIssue | undefined): string[] {
    if (editGate === undefined) return [];
    const { issue } = this.config.read.parent;
    return [
      "",
      `## Edit gate: ${this._refOf(editGate.issue)} is open, the Edit gate to close out first, by ${closeOutWords.closeProjectOf(issue)}'s \`piece.md\`, before ${this._refOf(issue)} closes`,
    ];
  }

  private _chainOf(when: string): string[] {
    return [
      `## Parent check, ${when}`,
      "",
      ...this.config.read.chain.map((link) => `- ${this._checkLineOf(link)}`),
    ];
  }

  private _checkLineOf({ child, check }: ParentLink): string {
    const label = this._refOf(child);
    if (check.kind === "none") return `${label} has no parent.`;
    const parent = `${label}'s parent ${this._refOf(check.parent)}`;
    if (check.kind === "map") {
      return `${parent} is a ${closeOutLabels.map}; it stays open for the Arrive operation.`;
    }
    if (check.kind === "open-sub-issues") {
      return `${parent} still has open sub-issues.`;
    }
    const { repo, number } = check.parent;
    return `${parent} has every sub-issue closed, so it is ready to close: \`npm run ${command} -- ${repo} ${number}\`.`;
  }

  private _refOf(ref: IssueRef): string {
    const { read, githubOwner } = this.config;
    return refLabelOf({ ref, seenFrom: read.parent.issue, githubOwner });
  }
}
