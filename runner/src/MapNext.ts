import {
  type IssueSource,
  listOf,
  type ReadableIssue,
  readCommandOf,
  trustedPart,
  untrustedBodyReasonOf,
  untrustedHeadingOf,
  untrustedTitleReasonOf,
} from "./IssueReader.ts";
import { type IssueRef, issueRef } from "./IssueWorkspaces.ts";

const usage =
  "usage: npm run map:next -- (<repo> <map> | <owner>/<repo> <map> | <map-url> | <map>) [<ticket> | <ticket-url>]";
const mapLabel = "wayfinder:map";
const typeLabelPrefix = "wayfinder:";
const issueUrlPattern =
  /^https:\/\/github\.com\/([^/]+)\/([^/]+)\/issues\/(\d+)\/?$/;
const numberPattern = /^\d+$/;

export interface MapNextConfig {
  source: IssueSource;
  developer: string;
  // Prefixes a ref in another repo, and is the one owner a map's URL or `<owner>/<repo>` may name.
  githubOwner: string;
  allowedRepos: string[];
}

interface MapRequest {
  map: IssueRef;
  // Undefined when none is named, so the frontier picks it.
  ticket: IssueRef | undefined;
}

interface ReadMap {
  map: ReadableIssue;
  // The sub-issues in the repo map, in map order; the reader reads no other repo.
  children: ReadableIssue[];
}

interface ChosenTicket {
  ticket: ReadableIssue | undefined;
  // Why it was chosen, or why none was.
  reason: string;
}

// `npm run map:next`'s core: a `/wayfinder` session's brief of a wayfinder map, read-only, printing only Trusted text.
// A brief returns its words on every outcome, a refusal or a failed read included, so its script exits 0 and a skill can inject it.
// The frontier is the issue-tracker doc's frontier query over native blocked-by edges; the labelling is IssueReader.ts's.
// The script is scripts/runner/mapNext.ts.
export class MapNext {
  private readonly config: MapNextConfig;

  constructor(config: MapNextConfig) {
    this.config = config;
  }

  static init(config: MapNextConfig): MapNext {
    return new MapNext(config);
  }

  // `currentRepo` is the repo whose clone holds the current folder, which a bare map number names; undefined outside one.
  async brief(
    args: string[],
    currentRepo: string | undefined,
  ): Promise<string> {
    let request: MapRequest;
    try {
      request = this._requestOf(args, currentRepo);
    } catch (error) {
      return noBriefOf(messageOf(error));
    }
    let read: ReadMap;
    try {
      read = await this._readOf(request.map);
    } catch (error) {
      return noBriefOf(
        `reading ${issueRef.labelOf(request.map)} from GitHub failed: ${messageOf(error)}`,
      );
    }
    if (!read.map.labels.includes(mapLabel)) {
      return noBriefOf(
        `${issueRef.labelOf(request.map)} is not a ${mapLabel}; its labels: ${listOf(read.map.labels)}`,
      );
    }
    return this._briefOf(read, request.ticket).join("\n");
  }

  private _requestOf(
    args: string[],
    currentRepo: string | undefined,
  ): MapRequest {
    const [first, second] = args;
    if (first === undefined) throw new Error(usage);
    if (issueUrlPattern.test(first)) {
      return this._withTicket(this._refOfUrl(first), args.slice(1));
    }
    if (numberPattern.test(first)) {
      if (currentRepo === undefined) {
        throw new Error(
          `the current folder is in no clone of the repo map, so a bare map number names no repo; ${usage}`,
        );
      }
      return this._withTicket(
        this._allowedRefOf(currentRepo, first),
        args.slice(1),
      );
    }
    if (second === undefined || !numberPattern.test(second)) {
      throw new Error(usage);
    }
    return this._withTicket(
      this._allowedRefOf(this._repoOfName(first), second),
      args.slice(2),
    );
  }

  private _withTicket(map: IssueRef, rest: string[]): MapRequest {
    const [ticket, ...extra] = rest;
    if (extra.length > 0) throw new Error(usage);
    if (ticket === undefined) return { map, ticket: undefined };
    if (numberPattern.test(ticket)) {
      return { map, ticket: { repo: map.repo, number: Number(ticket) } };
    }
    if (issueUrlPattern.test(ticket)) {
      return { map, ticket: this._refOfUrl(ticket) };
    }
    throw new Error(usage);
  }

  private _refOfUrl(url: string): IssueRef {
    const [, owner, repo, number] = issueUrlPattern.exec(url) ?? [];
    if (number === undefined) throw new Error(usage);
    return this._allowedRefOf(this._repoOfName(`${owner}/${repo}`), number);
  }

  // A bare name or `<owner>/<repo>`, as the repo map keys a bare name.
  private _repoOfName(name: string): string {
    const slash = name.indexOf("/");
    if (slash === -1) return name;
    const owner = name.slice(0, slash);
    if (owner !== this.config.githubOwner) {
      throw new Error(`${name} is not in the repo map`);
    }
    return name.slice(slash + 1);
  }

  private _allowedRefOf(repo: string, number: string): IssueRef {
    const { allowedRepos } = this.config;
    if (!allowedRepos.includes(repo)) {
      throw new Error(
        `repo "${repo}" is not one of ${allowedRepos.join(", ")}`,
      );
    }
    return { repo, number: Number(number) };
  }

  private async _readOf(mapRef: IssueRef): Promise<ReadMap> {
    const { source } = this.config;
    const map = await source.readableIssueOf(mapRef);
    const children = await Promise.all(
      map.subIssues
        .filter(({ repo }) => this._isAllowed(repo))
        .map((child) => source.readableIssueOf(child)),
    );
    return { map, children };
  }

  private _isAllowed(repo: string): boolean {
    return this.config.allowedRepos.includes(repo);
  }

  private _briefOf(read: ReadMap, named: IssueRef | undefined): string[] {
    const { map } = read;
    const frontier = read.children.filter(isOnFrontier);
    const chosen = this._chosenOf(read, frontier, named);
    return [
      `map:next brief of map ${issueRef.labelOf(map.issue)}: the map's body, its sub-issues with state, assignee and blocked-by edges, the frontier, and the chosen ticket's body and type. It holds all of them; don't read them again.`,
      "",
      `# Map ${this._headlineOf(map)}`,
      `State: ${stateOf(map)}`,
      `Labels: ${listOf(map.labels)}`,
      this._commentsLineOf(map),
      "",
      ...this._bodyOf("## Map body", map),
      "",
      "## Sub-issues, in map order",
      "",
      ...map.subIssues.map((child) => this._subIssueLineOf(read, child)),
      "",
      "## Frontier: open, unblocked, unassigned sub-issues",
      "",
      frontier.length === 0
        ? "None."
        : frontier.map(({ issue }) => this._refOf(map, issue)).join(", "),
      "",
      ...this._chosenPartOf(map, chosen),
    ];
  }

  private _chosenOf(
    { map, children }: ReadMap,
    frontier: ReadableIssue[],
    named: IssueRef | undefined,
  ): ChosenTicket {
    if (named === undefined) {
      const [first] = frontier;
      if (first === undefined) {
        return { ticket: undefined, reason: "none, the frontier is empty" };
      }
      return {
        ticket: first,
        reason: `${this._refOf(map, first.issue)}, first in the frontier`,
      };
    }
    const label = this._refOf(map, named);
    if (!issueRef.isAmong(named, map.subIssues)) {
      return {
        ticket: undefined,
        reason: `none, ${label} is not a sub-issue of map ${this._refOf(map, map.issue)}`,
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

  private _chosenPartOf(map: ReadableIssue, chosen: ChosenTicket): string[] {
    const heading = `## Chosen ticket: ${chosen.reason}`;
    const { ticket } = chosen;
    if (ticket === undefined) return [heading];
    return [
      heading,
      "",
      this._headlineOf(ticket),
      `State: ${stateOf(ticket)}`,
      `Type: ${typeOf(ticket)}`,
      this._commentsLineOf(ticket),
      "",
      ...this._bodyOf("## Ticket body", ticket),
    ];
  }

  private _subIssueLineOf({ map, children }: ReadMap, ref: IssueRef): string {
    const label = this._refOf(map, ref);
    const child = children.find(({ issue }) => issueRef.isSame(issue, ref));
    if (child === undefined) {
      return `- ${label}: not read, its repo is outside the repo map`;
    }
    const blockers = child.blockedBy.map(
      ({ issue, isOpen }) =>
        `${this._refOf(map, issue)} (${isOpen ? "open" : "closed"})`,
    );
    return `- ${this._headlineOf(child)}: ${stateOf(child)}; assignee: ${listOf(child.assignees)}; blocked by: ${listOf(blockers)}`;
  }

  // The number and title, the title only when Trusted.
  private _headlineOf(issue: ReadableIssue): string {
    const number = issueRef.numberLabelOf(issue.issue);
    const reason = untrustedTitleReasonOf(this.config.developer, issue);
    if (reason === undefined) return `${number} ${issue.title}`;
    return `${number} (title not printed, Untrusted text: ${reason}; ${readCommandOf(issue.issue, "--body")} reads it)`;
  }

  private _bodyOf(heading: string, issue: ReadableIssue): string[] {
    const reason = untrustedBodyReasonOf(this.config.developer, issue);
    if (reason === undefined) return trustedPart({ heading, text: issue.body });
    return [
      `${untrustedHeadingOf(heading, reason)}: not printed; ${readCommandOf(issue.issue, "--body")} reads it`,
    ];
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

  // A ref in another repo carries the repo owner, as IssueReader.ts prints one.
  private _refOf({ issue }: ReadableIssue, ref: IssueRef): string {
    if (ref.repo === issue.repo) return issueRef.numberLabelOf(ref);
    return `${this.config.githubOwner}/${ref.repo}#${ref.number}`;
  }
}

function noBriefOf(reason: string): string {
  return `map:next brief: none, ${reason}`;
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
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

function stateOf({ isOpen }: ReadableIssue): string {
  return isOpen ? "open" : "closed";
}

// Labels are Trusted, as IssueReader.ts reads a session's skill from them.
function typeOf({ labels }: ReadableIssue): string {
  const types = labels.filter(
    (label) => label.startsWith(typeLabelPrefix) && label !== mapLabel,
  );
  if (types.length === 0) return `none, no ${typeLabelPrefix}<type> label`;
  return types.join(", ");
}
