import { describe, expect, it } from "vitest";

import { closingPhrasesOf, refusalOf } from "./closingKeywords.ts";

describe("closingPhrasesOf", () => {
  it.each([
    ["Resolve #512 review: fix findings 1 and 2", "Resolve #512"],
    ["fixes ByronBroughten/byro-repo#12", "fixes ByronBroughten/byro-repo#12"],
    ["Closed: #3", "Closed: #3"],
    ["RESOLVES #4", "RESOLVES #4"],
    ["Tidy the loop.\n\nThis fixed #9 too.", "fixed #9"],
    ["close #1", "close #1"],
    ["Closes:#2", "Closes:#2"],
  ])("finds the closing phrase in %j", (message, phrase) => {
    expect(closingPhrasesOf(message)).toEqual([phrase]);
  });

  it.each([
    "R513.1: status counts a Batch member landed only once its gap check is done",
    "Merge issue-514-x into master (#514)",
    "Record the #514 outcome",
    "Fix the review of #512",
    "Fix findings 1 and 2 for #512",
    "Add the prefix#3 guard",
  ])("passes %j", (message) => {
    expect(closingPhrasesOf(message)).toEqual([]);
  });

  it("finds every closing phrase", () => {
    expect(closingPhrasesOf("Fix #1 and close #2")).toEqual([
      "Fix #1",
      "close #2",
    ]);
  });

  it("skips git's comment lines and the diff under a verbose commit's scissors", () => {
    expect(
      closingPhrasesOf(
        "Record the #514 outcome\n# Fixes #1 is only a comment\n# ------------------------ >8 ------------------------\n+fixes #2 in the diff",
      ),
    ).toEqual([]);
  });
});

describe("refusalOf", () => {
  it("names each phrase and says to reword it", () => {
    expect(refusalOf(["Resolve #512"])).toBe(
      'commit-msg: "Resolve #512" would close its issue once the commit reaches the default branch, and only the runner or /judge-findings closes a ticket. Reword it, for example "review of #512" or "for #512", and commit again.',
    );
  });
});
