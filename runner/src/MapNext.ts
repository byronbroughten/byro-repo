import { messageOf } from "./failureText.ts";
import { type IssueSource, listOf } from "./IssueReader.ts";
import { type IssueRef, issueRef } from "./IssueWorkspaces.ts";
import { MapArgsParser, type MapRequest } from "./MapNext/MapArgsParser.ts";
import {
  MapBriefWriter,
  type ReadMap,
  wayfinderLabels,
} from "./MapNext/MapBriefWriter.ts";

export interface MapNextConfig {
  source: IssueSource;
  developer: string;
  // Prefixes a ref in another repo, and is the one owner a map's URL or `<owner>/<repo>` may name.
  githubOwner: string;
  allowedRepos: string[];
}

// `npm run map:next`'s core: a `/wayfinder` session's brief of a wayfinder map, read-only, printing only Trusted text.
// A brief returns its words on every outcome, a refusal or a failed read included, so its script exits 0 and a skill can inject it.
// MapNext/ holds the argument parser and the brief's writer; the frontier is the issue-tracker doc's query over native blocked-by edges.
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
      request = new MapArgsParser(this.config).requestOf(args, currentRepo);
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
    if (!read.map.labels.includes(wayfinderLabels.map)) {
      return noBriefOf(
        `${issueRef.labelOf(request.map)} is not a ${wayfinderLabels.map}; its labels: ${listOf(read.map.labels)}`,
      );
    }
    const { developer, githubOwner } = this.config;
    return new MapBriefWriter({ read, developer, githubOwner })
      .linesOf(request.ticket)
      .join("\n");
  }

  private async _readOf(mapRef: IssueRef): Promise<ReadMap> {
    const { source, allowedRepos } = this.config;
    const map = await source.readableIssueOf(mapRef);
    const children = await Promise.all(
      map.subIssues
        .filter(({ repo }) => allowedRepos.includes(repo))
        .map((child) => source.readableIssueOf(child)),
    );
    return { map, children };
  }
}

// A brief's one line when it has nothing to brief, the script's own failure included.
export function noBriefOf(reason: string): string {
  return `map:next brief: none, ${reason}`;
}
