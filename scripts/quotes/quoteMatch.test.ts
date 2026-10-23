import { describe, expect, it } from "vitest";

import { findQuote, isJoined, pagesOf, quotesIn } from "./quoteMatch.ts";

const source = {
  file: "pmbok.txt",
  pages: pagesOf(
    "--- PDF page 104 ---\nEmotional intelligence is the ability to recog-\nnize our own emotions and those of others.\n--- PDF page 105 ---\nﬁnal text, and the work defined at the lowest level\n--- PDF page 106 ---\nof the work breakdown structure.",
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

describe("isJoined", () => {
  it("flags a quote that contains an ellipsis", () => {
    expect(isJoined("...projects often involve")).toBe(true);
    expect(isJoined("the total scope…the tasks")).toBe(true);
    expect(isJoined("the total scope of work")).toBe(false);
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

  it("matches a quote that crosses a page break, reporting the page it starts on", () => {
    expect(
      findQuote(
        "the work defined at the lowest level of the work breakdown structure.",
        [source],
      )?.page,
    ).toBe(105);
  });

  it("matches ligatures and letter case", () => {
    expect(findQuote("Final text,", [source])?.page).toBe(105);
  });

  it("does not match when the punctuation differs", () => {
    expect(findQuote("final text.", [source])).toBeUndefined();
    expect(findQuote("final text,", [source])?.page).toBe(105);
  });

  it("returns undefined for a paraphrase", () => {
    expect(
      findQuote("the ability to understand one's self", [source]),
    ).toBeUndefined();
  });
});
