import { assertAllowedRepo } from "../IssueReader.ts";
import type { IssueRef } from "../IssueWorkspaces.ts";

const usage =
  "usage: npm run map:next -- (<repo> <map> | <owner>/<repo> <map> | <map-url> | <map>) [<ticket> | <ticket-url>]";
const argPatterns = {
  issueUrl: /^https:\/\/github\.com\/([^/]+)\/([^/]+)\/issues\/(\d+)\/?$/,
  number: /^\d+$/,
} as const;

export interface MapArgsParserConfig {
  // The one owner a map's URL or `<owner>/<repo>` may name.
  githubOwner: string;
  allowedRepos: string[];
}

export interface MapRequest {
  map: IssueRef;
  // Undefined when none is named, so the frontier picks it.
  ticket: IssueRef | undefined;
}

// Reads `npm run map:next`'s arguments into the map and named ticket, throwing a refusal's words.
export class MapArgsParser {
  private readonly config: MapArgsParserConfig;

  constructor(config: MapArgsParserConfig) {
    this.config = config;
  }

  // `currentRepo` is the repo whose clone holds the current folder, which a bare map number names; undefined outside one.
  requestOf(args: string[], currentRepo: string | undefined): MapRequest {
    const [first, second] = args;
    if (first === undefined) throw new Error(usage);
    if (argPatterns.issueUrl.test(first)) {
      return this._withTicket(this._refOfUrl(first), args.slice(1));
    }
    if (argPatterns.number.test(first)) {
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
    if (second === undefined || !argPatterns.number.test(second)) {
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
    if (argPatterns.number.test(ticket)) {
      return { map, ticket: { repo: map.repo, number: Number(ticket) } };
    }
    if (argPatterns.issueUrl.test(ticket)) {
      return { map, ticket: this._refOfUrl(ticket) };
    }
    throw new Error(usage);
  }

  private _refOfUrl(url: string): IssueRef {
    const [, owner, repo, number] = argPatterns.issueUrl.exec(url) ?? [];
    if (number === undefined) throw new Error(usage);
    return this._allowedRefOf(this._repoOfName(`${owner}/${repo}`), number);
  }

  // A bare name or `<owner>/<repo>`, as the repo map keys a bare name.
  private _repoOfName(name: string): string {
    const slash = name.indexOf("/");
    if (slash === -1) return name;
    if (name.slice(0, slash) !== this.config.githubOwner) {
      throw new Error(`${name} is not in the repo map`);
    }
    return name.slice(slash + 1);
  }

  private _allowedRefOf(repo: string, number: string): IssueRef {
    assertAllowedRepo(repo, this.config.allowedRepos);
    return { repo, number: Number(number) };
  }
}
