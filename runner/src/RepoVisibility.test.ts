import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import type { ClonePaths } from "./clonePaths.ts";
import {
  repoRowsText,
  RepoVisibility,
  type Visibility,
  type VisibilitySource,
} from "./RepoVisibility.ts";

const clonePaths: ClonePaths = {
  "byro-repo": ".",
  "sheets-framework": "packages/framework",
  personal: "packages/personal",
};
const hourMs = 60 * 60 * 1000;
const readAt = new Date("2026-11-15T09:00:00.000Z");

class FakeVisibilitySource implements VisibilitySource {
  readonly visibilities: Record<string, Visibility>;
  readonly reads: string[] = [];

  constructor(visibilities: Record<string, Visibility>) {
    this.visibilities = visibilities;
  }

  async visibilityOf(repo: string): Promise<Visibility> {
    this.reads.push(repo);
    const visibility = this.visibilities[repo];
    if (!visibility) throw new Error(`No repo ${repo}`);
    return visibility;
  }
}

let stateFolder: string;
let source: FakeVisibilitySource;

beforeEach(() => {
  stateFolder = mkdtempSync(join(tmpdir(), "repo-visibility-"));
  source = new FakeVisibilitySource({
    "byro-repo": "public",
    "sheets-framework": "public",
    personal: "private",
  });
});

afterEach(() => {
  rmSync(stateFolder, { recursive: true, force: true });
});

function visibilityAt(time: Date): RepoVisibility {
  return RepoVisibility.init({
    stateFolder,
    source,
    clock: { now: () => time },
  });
}

function cacheFile(): unknown {
  return JSON.parse(
    readFileSync(join(stateFolder, "repo-visibility.json"), "utf8"),
  );
}

describe("RepoVisibility", () => {
  it("reads GitHub with no cache, prints a row per repo and writes the cache", async () => {
    const rows = await visibilityAt(readAt).rowsOf(clonePaths);

    expect(repoRowsText(rows)).toBe(
      [
        "byro-repo         .                   public",
        "sheets-framework  packages/framework  public",
        "personal          packages/personal   private",
      ].join("\n"),
    );
    expect(cacheFile()).toEqual({
      readAt: "2026-11-15T09:00:00.000Z",
      visibilities: {
        "byro-repo": "public",
        "sheets-framework": "public",
        personal: "private",
      },
    });
  });

  it("answers from a cache under a day old without reading GitHub", async () => {
    await visibilityAt(readAt).rowsOf(clonePaths);
    source.reads.length = 0;
    source.visibilities.personal = "public";

    const rows = await visibilityAt(
      new Date(readAt.getTime() + 23 * hourMs),
    ).rowsOf(clonePaths);

    expect(source.reads).toEqual([]);
    expect(rows.find(({ repo }) => repo === "personal")?.visibility).toBe(
      "private",
    );
  });

  it("re-reads and rewrites a cache a day old", async () => {
    await visibilityAt(readAt).rowsOf(clonePaths);
    source.visibilities.personal = "public";
    const later = new Date(readAt.getTime() + 24 * hourMs);

    const rows = await visibilityAt(later).rowsOf(clonePaths);

    expect(rows.find(({ repo }) => repo === "personal")?.visibility).toBe(
      "public",
    );
    expect(cacheFile()).toMatchObject({
      readAt: later.toISOString(),
      visibilities: { personal: "public" },
    });
  });

  it("re-reads a fresh cache on a refresh", async () => {
    await visibilityAt(readAt).rowsOf(clonePaths);
    source.visibilities.personal = "public";
    const later = new Date(readAt.getTime() + hourMs);

    const rows = await visibilityAt(later).refreshedRowsOf(clonePaths);

    expect(rows.find(({ repo }) => repo === "personal")?.visibility).toBe(
      "public",
    );
    expect(cacheFile()).toMatchObject({ readAt: later.toISOString() });
  });

  it("re-reads a fresh cache missing a repo the map now holds", async () => {
    await visibilityAt(readAt).rowsOf({ "byro-repo": "." });
    source.reads.length = 0;

    await visibilityAt(new Date(readAt.getTime() + hourMs)).rowsOf(clonePaths);

    expect(source.reads).toEqual(["byro-repo", "sheets-framework", "personal"]);
  });
});
