import { describe, expect, it } from "vitest";

import { imagePlaceholders } from "./imagePlaceholders.ts";

const body =
  "Prose before.\n\n\\[Image 1: sales\\_by\\_month.png\\]\n\nProse between.\n\n\\[Image 2: Sales rose each month; March was the highest.\\]\n\nProse after.\n";

describe("imagePlaceholders", () => {
  it("returns each placeholder's number and its file name or its facts", () => {
    expect(imagePlaceholders.of(body)).toEqual([
      { number: 1, file: "sales_by_month.png" },
      { number: 2, facts: "Sales rose each month; March was the highest." },
    ]);
  });

  it("names a file whose PNG extension is in capitals", () => {
    expect(imagePlaceholders.of("\\[Image 1: Chart.PNG\\]\n")).toEqual([
      { number: 1, file: "Chart.PNG" },
    ]);
  });

  it("reads text that is more than one PNG file name as facts", () => {
    expect(
      imagePlaceholders.of(
        "\\[Image 3: chart.png and table.png\\]\n\n\\[Image 4: chart.svg\\]\n",
      ),
    ).toEqual([
      { number: 3, facts: "chart.png and table.png" },
      { number: 4, facts: "chart.svg" },
    ]);
  });

  it("finds no placeholder in a bracket that isn't a paragraph of its own", () => {
    expect(
      imagePlaceholders.of(
        "See \\[Image 1: chart.png\\] here.\n\n- \\[Image 2: chart.png\\]\n",
      ),
    ).toEqual([]);
  });

  it("leaves each placeholder paragraph out of a body's prose", () => {
    expect(imagePlaceholders.proseOf(body)).toBe(
      "Prose before.\n\nProse between.\n\nProse after.\n",
    );
  });
});
