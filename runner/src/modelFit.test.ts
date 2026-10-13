import { describe, expect, it } from "vitest";

import { pairOf } from "./modelFit.ts";

function bodyWith(section: string): string {
  return `## What to build\n\nA thing.\n\n${section}`;
}

describe("pairOf", () => {
  it("reads the pair line of a last Model fit section", () => {
    const body = bodyWith(
      "## Model fit\n\nOpus high\nThe seam ports choose.\n",
    );

    expect(pairOf(body)).toEqual({ model: "opus", effort: "high" });
  });

  it("reads Sonnet medium", () => {
    expect(pairOf(bodyWith("## Model fit\nSonnet medium\nSmall."))).toEqual({
      model: "sonnet",
      effort: "medium",
    });
  });

  it("refuses a pair outside the five", () => {
    expect(pairOf(bodyWith("## Model fit\n\nSonnet low\nToo cheap."))).toBe(
      undefined,
    );
  });

  it("refuses a body with no Model fit section", () => {
    expect(pairOf("## What to build\n\nOpus high")).toBe(undefined);
  });

  it("refuses a Model fit section that is not the last", () => {
    const body = "## Model fit\n\nOpus low\nWhy.\n\n## Notes\n\nMore.";

    expect(pairOf(body)).toBe(undefined);
  });
});
