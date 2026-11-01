import { describe, expect, it } from "vitest";

import { launchArgsOf } from "./launchArgs.ts";

describe("launchArgsOf", () => {
  it("reads one number as a run of one member", () => {
    expect(launchArgsOf(["byronbroughten/byro-repo", "498"])).toEqual({
      owner: "byronbroughten",
      members: [{ repo: "byro-repo", number: 498 }],
    });
  });

  it("reads a list in typed order, a repeated number once", () => {
    expect(
      launchArgsOf(["byronbroughten/byro-repo", "498", "450", "498", "499"]),
    ).toEqual({
      owner: "byronbroughten",
      members: [
        { repo: "byro-repo", number: 498 },
        { repo: "byro-repo", number: 450 },
        { repo: "byro-repo", number: 499 },
      ],
    });
  });

  it("refuses no number, a non-number or a bare repo", () => {
    expect(launchArgsOf(["byronbroughten/byro-repo"])).toBeUndefined();
    expect(
      launchArgsOf(["byronbroughten/byro-repo", "498", "--once"]),
    ).toBeUndefined();
    expect(launchArgsOf(["byro-repo", "498"])).toBeUndefined();
  });
});
