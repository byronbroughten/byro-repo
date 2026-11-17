import { describe, expect, it } from "vitest";

import { launchArgsOf, type RepoMap } from "./launchArgs.ts";

const repoMap: RepoMap = {
  githubOwner: "byronbroughten",
  clonePaths: { "byro-repo": ".", "sheets-framework": "packages/framework" },
};

describe("launchArgsOf", () => {
  it("reads one number as a run of one member", () => {
    expect(launchArgsOf(["byronbroughten/byro-repo", "498"], repoMap)).toEqual({
      owner: "byronbroughten",
      members: [{ repo: "byro-repo", number: 498 }],
    });
  });

  it("reads a list in typed order, a repeated number once", () => {
    expect(
      launchArgsOf(
        ["byronbroughten/byro-repo", "498", "450", "498", "499"],
        repoMap,
      ),
    ).toEqual({
      owner: "byronbroughten",
      members: [
        { repo: "byro-repo", number: 498 },
        { repo: "byro-repo", number: 450 },
        { repo: "byro-repo", number: 499 },
      ],
    });
  });

  it("reads a bare repo the map holds as its owner/repo form", () => {
    expect(launchArgsOf(["sheets-framework", "12", "13"], repoMap)).toEqual(
      launchArgsOf(["byronbroughten/sheets-framework", "12", "13"], repoMap),
    );
  });

  it("refuses no number, a non-number, a malformed repo or one the map doesn't hold", () => {
    expect(launchArgsOf(["byronbroughten/byro-repo"], repoMap)).toBeUndefined();
    expect(
      launchArgsOf(["byronbroughten/byro-repo", "498", "--once"], repoMap),
    ).toBeUndefined();
    expect(launchArgsOf(["a/b/c", "498"], repoMap)).toBeUndefined();
    expect(launchArgsOf(["/byro-repo", "498"], repoMap)).toBeUndefined();
    expect(launchArgsOf(["unknown-repo", "498"], repoMap)).toBeUndefined();
    expect(launchArgsOf(["", "498"], repoMap)).toBeUndefined();
  });
});
