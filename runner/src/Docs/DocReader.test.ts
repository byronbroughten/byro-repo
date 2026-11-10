import { describe, expect, it } from "vitest";

import { fixtureDocument } from "./docFixtures.ts";
import { DocReader } from "./DocReader.ts";

function markdownOf(fixture: string): string {
  return DocReader.init(fixtureDocument(fixture)).markdown;
}

describe("DocReader", () => {
  it("reads the title and headings as hashes and drops empty paragraphs", () => {
    expect(markdownOf("headings")).toBe(
      [
        "# A Field Guide to Kettles",
        "",
        "## Why kettles",
        "",
        "A kettle boils water faster than a pan.",
        "",
        "### Spouts",
        "",
        "Most spouts face away.",
        "",
        "## Which kettle",
        "",
        "Buy the one with a whistle.",
        "",
      ].join("\n"),
    );
  });

  it("reads bold, italic, links and internal heading links, escaping Markdown characters", () => {
    expect(markdownOf("inline")).toBe(
      [
        "## Lids",
        "",
        "A lid is **never optional**, and a *loose* one ***rattles***.",
        "",
        "See [the kettle survey](https://example.com/survey) and [the **lid notes**](#lids) for a\\_b and \\[c\\] at 5\\*6.",
        "",
        "\\# is not a heading here.",
        "",
        "Line one<br>line two.",
        "",
      ].join("\n"),
    );
  });

  it("numbers ordered lists across an interruption, restarts nested numbering under each parent, and indents nested items", () => {
    expect(markdownOf("lists")).toBe(
      [
        "## Steps",
        "",
        "1. Fill the kettle.",
        "2. Switch it on.",
        "",
        "Wait for the click.",
        "",
        "3. Pour.",
        "",
        "## Kinds",
        "",
        "- Stovetop",
        "    1. Whistling",
        "    2. Plain",
        "- Electric",
        "    1. Cordless",
        "        - Base only",
        "- Tea leaves",
        "- Tea bags",
        "",
      ].join("\n"),
    );
  });

  it("reads a table with its first row as the header, dropping the empty paragraphs around it and in its cells", () => {
    expect(markdownOf("table")).toBe(
      [
        "## Costs",
        "",
        "Three kettles compared.",
        "",
        "| **Kettle** | Price |",
        "| --- | --- |",
        "| Copper | High<br>Worth it \\| mostly |",
        "| Steel |  |",
        "",
        "Steel wins on price.",
        "",
      ].join("\n"),
    );
  });

  it("reads a tab's footnotes as definitions at the end of the Section that cites them", () => {
    expect(markdownOf("footnotes")).toBe(
      [
        "## Scale",
        "",
        "Hard water leaves scale[^1] inside.",
        "",
        "### Detail",
        "",
        "Vinegar lifts it[^2].",
        "",
        "[^1]: Mostly *calcium*.",
        "[^2]: White vinegar.",
        "",
        "## Rinsing",
        "",
        "Rinse twice[^3].",
        "",
        "[^3]: Cold water.",
        "",
      ].join("\n"),
    );
  });

  it("leaves out pending suggested insertions and keeps text suggested for deletion", () => {
    expect(markdownOf("suggestions")).toBe(
      [
        "## Storage",
        "",
        "Empty the kettle after use.",
        "",
        "Store it dry.",
        "",
      ].join("\n"),
    );
  });
});
