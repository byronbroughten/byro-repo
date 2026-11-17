import {
  briefBodyOf,
  briefHeadlineOf,
  listOf,
  type ReadableIssue,
  readCommandOf,
  refLabelOf,
  stateWordOf,
} from "../IssueReader.ts";
import { type IssueRef, issueRef } from "../IssueWorkspaces.ts";

export const wayfinderLabels = {
  map: "wayfinder:map",
  typePrefix: "wayfinder:",
} as const;

export interface ReadMap {
  map: ReadableIssue;
  // The sub-issues in the repo map, in map order; the reader reads no other repo.
  children: ReadableIssue[];
}

export interface MapBriefWriterConfig {
  read: ReadMap;
  developer: string;
  // Prefixes a ref in another repo.
  githubOwner: string;
}

interface ChosenTicket {
  ticket: ReadableIssue | undefined;
  // Why it was chosen, or why none was.
  reason: string;
}

// Words one read map's brief, printing only Trusted text and counting the rest with the command that reads it.
export class MapBriefWriter {
  private readonly config: MapBriefWriterConfig;

  constructor(config: MapBriefWriterConfig) {
    this.config = config;
  }

  // Undefined `named` lets the frontier pick the ticket.
  linesOf(named: IssueRef | undefined): string[] {
    const { map, children } = this.config.read;
    const frontier = children.filter(isOnFrontier);
    return [
      `map:next brief of map ${issueRef.labelOf(map.issue)}: the map's body, its sub-issues with state, assignee and blocked-by edges, the frontier, and the chosen ticket's body and type. It holds all of them; don't read them again.`,
      "",
      `# Map ${this._headlineOf(map)}`,
      `State: ${stateWordOf(map.isOpen)}`,
      `Labels: ${listOf(map.labels)}`,
      this._commentsLineOf(map),
      "",
      ...this._bodyOf("## Map body", map),
      "",
      "## Sub-issues, in map order",
      "",
      ...map.subIssues.map((child) => this._subIssueLineOf(child)),
      "",
      "## Frontier: open, unblocked, unassigned sub-issues",
      "",
      frontier.length === 0
        ? "None."
        : frontier.map(({ issue }) => this._refOf(issue)).join(", "),
      "",
      ...this._chosenPartOf(this._chosenOf(frontier, named)),
    ];
  }

  private _chosenOf(
    frontier: ReadableIssue[],
    named: IssueRef | undefined,
  ): ChosenTicket {
    const { map, children } = this.config.read;
    if (named === undefined) {
      const [first] = frontier;
      if (first === undefined) {
        return { ticket: undefined, reason: "none, the frontier is empty" };
      }
      return {
        ticket: first,
        reason: `${this._refOf(first.issue)}, first in the frontier`,
      };
    }
    const label = this._refOf(named);
    if (!issueRef.isAmong(named, map.subIssues)) {
      return {
        ticket: undefined,
        reason: `none, ${label} is not a sub-issue of map ${this._refOf(map.issue)}`,
      };
    }
    const ticket = children.find((child) =>
      issueRef.isSame(child.issue, named),
    );
    if (ticket === undefined) {
      return {
        ticket: undefined,
        reason: `none, ${label} is outside the repo map`,
      };
    }
    return { ticket, reason: `${label}, named` };
  }

  private _chosenPartOf({ ticket, reason }: ChosenTicket): string[] {
    const heading = `## Chosen ticket: ${reason}`;
    if (ticket === undefined) return [heading];
    return [
      heading,
      "",
      this._headlineOf(ticket),
      `State: ${stateWordOf(ticket.isOpen)}`,
      `Type: ${typeOf(ticket)}`,
      this._commentsLineOf(ticket),
      "",
      ...this._bodyOf("## Ticket body", ticket),
    ];
  }

  private _subIssueLineOf(ref: IssueRef): string {
    const label = this._refOf(ref);
    const child = this.config.read.children.find(({ issue }) =>
      issueRef.isSame(issue, ref),
    );
    if (child === undefined) {
      return `- ${label}: not read, its repo is outside the repo map`;
    }
    const blockers = child.blockedBy.map(
      ({ issue, isOpen }) => `${this._refOf(issue)} (${stateWordOf(isOpen)})`,
    );
    return `- ${this._headlineOf(child)}: ${stateWordOf(child.isOpen)}; assignee: ${listOf(child.assignees)}; blocked by: ${listOf(blockers)}`;
  }

  private _headlineOf(issue: ReadableIssue): string {
    return briefHeadlineOf(this.config.developer, issue);
  }

  private _bodyOf(heading: string, issue: ReadableIssue): string[] {
    return briefBodyOf(this.config.developer, heading, issue);
  }

  // Comments only count here, the developer's too, since the spec's brief holds bodies alone.
  private _commentsLineOf({
    issue,
    comments,
    hasUnreadComments,
  }: ReadableIssue): string {
    if (comments.length === 0 && !hasUnreadComments) return "Comments: none";
    const { developer } = this.config;
    const developers = comments.filter(({ author }) => author === developer);
    const others = comments.length - developers.length;
    const more = hasUnreadComments ? ", and more past the first 100" : "";
    return `Comments: ${developers.length} by ${developer} (Trusted text), ${others} by others (Untrusted text)${more}, not printed; ${readCommandOf(issue, "--comments")} reads them`;
  }

  private _refOf(ref: IssueRef): string {
    const { read, githubOwner } = this.config;
    return refLabelOf({ ref, seenFrom: read.map.issue, githubOwner });
  }
}

// The issue-tracker doc's frontier query: open, with no open blocker and no assignee.
function isOnFrontier({
  isOpen,
  assignees,
  blockedBy,
}: ReadableIssue): boolean {
  return (
    isOpen &&
    assignees.length === 0 &&
    !blockedBy.some((blocker) => blocker.isOpen)
  );
}

// Labels are Trusted, as IssueReader.ts reads a session's skill from them.
function typeOf({ labels }: ReadableIssue): string {
  const { map, typePrefix } = wayfinderLabels;
  const types = labels.filter(
    (label) => label.startsWith(typePrefix) && label !== map,
  );
  if (types.length === 0) return `none, no ${typePrefix}<type> label`;
  return types.join(", ");
}
