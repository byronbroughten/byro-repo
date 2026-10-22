import { describe, expect, it } from "vitest";

import { findQuote, pagesOf, quotesIn } from "./quoteMatch.ts";

const source = {
  file: "pmbok.txt",
  pages: pagesOf(
    "--- PDF page 104 ---\nEmotional intelligence is the ability to recog-\nnize our own emotions and those of others.\n--- PDF page 105 ---\nﬁnal text.",
  ),
};

describe("quotesIn", () => {
  it("returns quoted spans of four or more words and skips shorter ones", () => {
    const comment =
      'F1. "Emotional intelligence is the ability" and "short one" and “don’t always circle the low bidder”';

    expect(quotesIn(comment)).toEqual([
      "Emotional intelligence is the ability",
      "don’t always circle the low bidder",
    ]);
  });
});

describe("findQuote", () => {
  it("matches a quote across a line break and a hyphenated line end, reporting its page", () => {
    expect(
      findQuote(
        "Emotional intelligence is the ability to recognize our own emotions",
        [source],
      ),
    ).toEqual({
      quote:
        "Emotional intelligence is the ability to recognize our own emotions",
      file: "pmbok.txt",
      page: 104,
    });
  });

  it("matches ligatures and returns undefined for a paraphrase", () => {
    expect(findQuote("Final text.", [source])?.page).toBe(105);
    expect(
      findQuote("the ability to understand one's self", [source]),
    ).toBeUndefined();
  });
});
