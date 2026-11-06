import { describe, expect, it } from "vitest";

import { markedPages, pagesOf, verifyComment } from "./quoteMatch.ts";

const pmbok = {
  file: "pmbok.txt",
  text: "--- PDF page 104 ---\nEmotional intelligence is the ability to recog-\nnize our own emotions and those of others.\n--- PDF page 105 ---\nﬁnal text, and the work defined at the lowest level\n--- PDF page 106 ---\nof the work breakdown structure.",
};

const heagney = {
  file: "heagney.txt",
  text: "--- PDF page 45 ---\nA project is a one-time job.\n--- PDF page 46 ---\nScope creep is a risk.",
};

const notes = {
  file: "notes.txt",
  text: "Scope of work\nThe crew starts on Monday.\n",
};

const sources = [pmbok, heagney, notes];

function factCiting(locator: string, quote: string): string {
  return `1. The source says "${quote}" (${locator})`;
}

describe("markedPages", () => {
  it("numbers every page, a blank one included, and drops the empty piece after the last form feed", () => {
    const pages = pagesOf(markedPages("Title page\f\f  \fChapter 1\f"));

    expect(pages.map((page) => page.number)).toEqual([1, 2, 3, 4]);
    expect(pages[3]?.text).toBe("\nChapter 1\n");
  });
});

describe("verifyComment", () => {
  it("fails a numbered fact with no locator", () => {
    expect(verifyComment("1. Projects are one-time jobs.", sources)).toEqual([
      { kind: "noLocator", fact: 1, citedFile: undefined },
    ]);
  });

  it("fails a locator that names no saved text", () => {
    expect(
      verifyComment(
        "1. Projects are one-time jobs. (gone.txt, PDF p. 4)",
        sources,
      ),
    ).toEqual([{ kind: "noLocator", fact: 1, citedFile: "gone.txt" }]);
  });

  it("fails a PDF-page locator on a source with no page markers, a quoteless fact included", () => {
    expect(
      verifyComment(
        "1. The crew starts on Monday. (notes.txt, PDF p. 1)",
        sources,
      ),
    ).toEqual([
      {
        kind: "noLocator",
        fact: 1,
        citedFile: "notes.txt",
        missingPages: { first: 1, last: 1 },
      },
    ]);
  });

  it("fails a page range that runs past the source's last page", () => {
    expect(
      verifyComment(
        factCiting("heagney.txt, PDF pp. 46–47", "Scope creep is a risk."),
        sources,
      ),
    ).toEqual([
      {
        kind: "noLocator",
        fact: 1,
        citedFile: "heagney.txt",
        missingPages: { first: 46, last: 47 },
      },
    ]);
  });

  it("passes a fact with a locator and no quote", () => {
    expect(
      verifyComment(
        "1. Projects are one-time jobs. (heagney.txt, PDF pp. 45–46 (printed 31–32))",
        sources,
      ),
    ).toEqual([]);
  });

  it("checks a quote under four words and finds it on the cited page", () => {
    expect(
      verifyComment(
        factCiting("heagney.txt, PDF p. 45", "one-time job"),
        sources,
      ),
    ).toEqual([
      {
        kind: "found",
        fact: 1,
        quote: "one-time job",
        file: "heagney.txt",
        page: 45,
      },
    ]);
  });

  it("fails a quote found only on another page of the cited source", () => {
    expect(
      verifyComment(
        factCiting("heagney.txt, PDF p. 45", "Scope creep"),
        sources,
      ),
    ).toEqual([
      {
        kind: "outsideLocator",
        fact: 1,
        quote: "Scope creep",
        file: "heagney.txt",
        page: 46,
      },
    ]);
  });

  it("fails a quote found only in another source", () => {
    expect(
      verifyComment(
        factCiting("heagney.txt, PDF pp. 45–46", "final text,"),
        sources,
      ),
    ).toEqual([
      {
        kind: "outsideLocator",
        fact: 1,
        quote: "final text,",
        file: "pmbok.txt",
        page: 105,
      },
    ]);
  });

  it("matches a quote that crosses a page break within a cited range that does too", () => {
    expect(
      verifyComment(
        factCiting(
          "pmbok.txt, PDF pp. 105–106",
          "the work defined at the lowest level of the work breakdown structure.",
        ),
        sources,
      ),
    ).toEqual([
      {
        kind: "found",
        fact: 1,
        quote:
          "the work defined at the lowest level of the work breakdown structure.",
        file: "pmbok.txt",
        page: 105,
      },
    ]);
  });

  it("matches a quote under a heading locator anywhere in that unpaged source", () => {
    expect(
      verifyComment(
        factCiting('notes.txt, heading "Scope of work"', "starts on Monday"),
        sources,
      ),
    ).toEqual([
      {
        kind: "found",
        fact: 1,
        quote: "starts on Monday",
        file: "notes.txt",
        page: undefined,
      },
    ]);
  });

  it("fails a quote under a heading locator found only in another source", () => {
    expect(
      verifyComment(
        factCiting('notes.txt, heading "Scope of work"', "Scope creep"),
        sources,
      ),
    ).toEqual([
      {
        kind: "outsideLocator",
        fact: 1,
        quote: "Scope creep",
        file: "heagney.txt",
        page: 46,
      },
    ]);
  });

  it("skips the Unverified section", () => {
    const comment = [
      "1. A project is temporary. (heagney.txt, PDF p. 45)",
      "",
      "## Unverified",
      "",
      '1. A fact with "words nowhere in any source" and no locator.',
    ].join("\n");

    expect(verifyComment(comment, sources)).toEqual([]);
  });

  it("does not read italics as quotes", () => {
    expect(
      verifyComment(
        "1. The *Guide to the Body of Knowledge* defines it. (pmbok.txt, PDF p. 104)",
        sources,
      ),
    ).toEqual([]);
  });

  it("fails a quote that joins two passages with an ellipsis", () => {
    expect(
      verifyComment(
        factCiting(
          "pmbok.txt, PDF p. 104",
          "Emotional intelligence…of others.",
        ),
        sources,
      ),
    ).toEqual([
      {
        kind: "joined",
        fact: 1,
        quote: "Emotional intelligence…of others.",
      },
    ]);
  });

  it("matches a quote across a line break and a hyphenated line end", () => {
    expect(
      verifyComment(
        factCiting(
          "pmbok.txt, PDF p. 104",
          "Emotional intelligence is the ability to recognize our own emotions",
        ),
        sources,
      ),
    ).toEqual([
      {
        kind: "found",
        fact: 1,
        quote:
          "Emotional intelligence is the ability to recognize our own emotions",
        file: "pmbok.txt",
        page: 104,
      },
    ]);
  });

  it("matches ligatures and letter case", () => {
    expect(
      verifyComment(
        factCiting("pmbok.txt, PDF p. 105", "Final text,"),
        sources,
      ),
    ).toEqual([
      {
        kind: "found",
        fact: 1,
        quote: "Final text,",
        file: "pmbok.txt",
        page: 105,
      },
    ]);
  });

  it("matches curly quotes around a quote", () => {
    expect(
      verifyComment(
        "1. It starts “on Monday.” (notes.txt, heading “Scope of work”)",
        sources,
      ),
    ).toEqual([
      {
        kind: "found",
        fact: 1,
        quote: "on Monday.",
        file: "notes.txt",
        page: undefined,
      },
    ]);
  });

  it("does not match when the punctuation differs", () => {
    expect(
      verifyComment(
        factCiting("pmbok.txt, PDF p. 105", "final text."),
        sources,
      ),
    ).toEqual([{ kind: "notFound", fact: 1, quote: "final text." }]);
  });

  it("does not match a paraphrase", () => {
    expect(
      verifyComment(
        factCiting(
          "pmbok.txt, PDF p. 104",
          "the ability to understand one's self",
        ),
        sources,
      ),
    ).toEqual([
      {
        kind: "notFound",
        fact: 1,
        quote: "the ability to understand one's self",
      },
    ]);
  });

  it("checks each fact of a list under its own number, a fact running onto a second line included", () => {
    const comment = [
      "Facts from the sources:",
      "",
      '1. A project is "a one-time job." (heagney.txt, PDF p. 45)',
      "2. Scope creep is named as",
      '   "a risk." (heagney.txt, PDF p. 46)',
      "3. Crews start on Mondays.",
    ].join("\n");

    expect(
      verifyComment(comment, sources).map((finding) => [
        finding.kind,
        finding.fact,
      ]),
    ).toEqual([
      ["found", 1],
      ["found", 2],
      ["noLocator", 3],
    ]);
  });
});
