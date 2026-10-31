import { describe, expect, it } from "vitest";

import { modelFitTextOf, pairOf, strongerPairOf } from "./modelFit.ts";

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

  it("reads Haiku medium", () => {
    expect(pairOf(bodyWith("## Model fit\nHaiku medium\nTiny."))).toEqual({
      model: "haiku",
      effort: "medium",
    });
  });

  it("refuses a pair outside the six", () => {
    expect(pairOf(bodyWith("## Model fit\n\nSonnet low\nToo cheap."))).toBe(
      undefined,
    );
    expect(pairOf(bodyWith("## Model fit\n\nHaiku high\nToo much."))).toBe(
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

describe("modelFitTextOf", () => {
  it("joins a last Model fit section's pair line and reason", () => {
    const body = bodyWith(
      "## Model fit\n\nOpus medium\nA new module's shape.\nWithin a settled design.\n",
    );

    expect(modelFitTextOf(body)).toBe(
      "Opus medium: A new module's shape. Within a settled design.",
    );
  });

  it("keeps a pair line outside the six as written", () => {
    expect(modelFitTextOf(bodyWith("## Model fit\n\nSonnet low"))).toBe(
      "Sonnet low",
    );
  });

  it("is undefined with no last Model fit section", () => {
    expect(modelFitTextOf("## Model fit\n\nOpus low\n\n## Notes")).toBe(
      undefined,
    );
  });
});

describe("strongerPairOf", () => {
  const opusMedium = { model: "opus", effort: "medium" } as const;

  it("picks the ticket's pair when it is Opus high", () => {
    const opusHigh = { model: "opus", effort: "high" } as const;
    expect(strongerPairOf(opusMedium, opusHigh)).toEqual(opusHigh);
  });

  it("keeps Opus medium over a lower Opus effort or any Sonnet", () => {
    const opusLow = { model: "opus", effort: "low" } as const;
    const sonnetHigh = { model: "sonnet", effort: "high" } as const;
    expect(strongerPairOf(opusMedium, opusLow)).toEqual(opusMedium);
    expect(strongerPairOf(opusMedium, sonnetHigh)).toEqual(opusMedium);
  });
});
