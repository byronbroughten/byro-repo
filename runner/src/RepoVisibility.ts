// `npm run repos`'s core: each repo in the repo map with its path and whether GitHub holds it private.
// Visibility is cached in the state folder for a day rather than committed, so a repo made public or private
// later never leaves a stale list; only an old or missing cache, or a refresh, reads GitHub again.
// The entry, which passes the `gh` port, is `scripts/runner/repos.ts`.

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import type { ClonePaths } from "./clonePaths.ts";
import type { Clock } from "./SpecRun.ts";

export type Visibility = "private" | "public";

export interface VisibilitySource {
  visibilityOf(repo: string): Promise<Visibility>;
}

export interface RepoRow {
  repo: string;
  clonePath: string;
  visibility: Visibility;
}

interface RepoVisibilityProps {
  stateFolder: string;
  source: VisibilitySource;
  clock: Clock;
}

type VisibilityByRepo = Record<string, Visibility>;

interface VisibilityCache {
  readAt: string;
  visibilities: VisibilityByRepo;
}

const cacheLifeMs = 24 * 60 * 60 * 1000;

export class RepoVisibility {
  readonly stateFolder: string;
  readonly source: VisibilitySource;
  readonly clock: Clock;
  private readonly _cachePath: string;

  constructor({ stateFolder, source, clock }: RepoVisibilityProps) {
    this.stateFolder = stateFolder;
    this.source = source;
    this.clock = clock;
    this._cachePath = join(stateFolder, "repo-visibility.json");
  }

  static init(props: RepoVisibilityProps): RepoVisibility {
    return new RepoVisibility(props);
  }

  async rowsOf(clonePaths: ClonePaths): Promise<RepoRow[]> {
    const cache = this._cache;
    if (cache && this._isFresh(cache, clonePaths)) {
      return rowsFrom(clonePaths, cache.visibilities);
    }
    return this.refreshedRowsOf(clonePaths);
  }

  async refreshedRowsOf(clonePaths: ClonePaths): Promise<RepoRow[]> {
    const repos = Object.keys(clonePaths);
    const read = await Promise.all(
      repos.map((repo) => this.source.visibilityOf(repo)),
    );
    const visibilities = repos.reduce<VisibilityByRepo>((byRepo, repo, at) => {
      byRepo[repo] = read[at] as Visibility;
      return byRepo;
    }, {});
    this._store({ readAt: this.clock.now().toISOString(), visibilities });
    return rowsFrom(clonePaths, visibilities);
  }

  private get _cache(): VisibilityCache | undefined {
    if (!existsSync(this._cachePath)) return undefined;
    return JSON.parse(readFileSync(this._cachePath, "utf8")) as VisibilityCache;
  }

  // A repo the map gained since the read has no cached answer, so it counts as missing.
  private _isFresh(cache: VisibilityCache, clonePaths: ClonePaths): boolean {
    const ageMs = this.clock.now().getTime() - Date.parse(cache.readAt);
    return (
      ageMs < cacheLifeMs &&
      Object.keys(clonePaths).every(
        (repo) => cache.visibilities[repo] !== undefined,
      )
    );
  }

  private _store(cache: VisibilityCache): void {
    mkdirSync(this.stateFolder, { recursive: true });
    writeFileSync(this._cachePath, `${JSON.stringify(cache, undefined, 2)}\n`);
  }
}

export function repoRowsText(rows: RepoRow[]): string {
  const repoWidth = Math.max(...rows.map(({ repo }) => repo.length));
  const pathWidth = Math.max(...rows.map(({ clonePath }) => clonePath.length));
  return rows
    .map(
      ({ repo, clonePath, visibility }) =>
        `${repo.padEnd(repoWidth)}  ${clonePath.padEnd(pathWidth)}  ${visibility}`,
    )
    .join("\n");
}

function rowsFrom(
  clonePaths: ClonePaths,
  visibilities: VisibilityByRepo,
): RepoRow[] {
  return Object.entries(clonePaths).map(([repo, clonePath]) => ({
    repo,
    clonePath,
    visibility: visibilities[repo] as Visibility,
  }));
}
