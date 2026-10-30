import { describe, expect, it } from "vitest";

import { progressLineOf, stampedLineOf } from "./progressLines.ts";

// The tooling project's tests run in America/Chicago, so local times read as CDT or CST.
describe("progress lines", () => {
  it("stamps a line in local time with its zone", () => {
    const time = new Date("2026-10-29T12:49:05.000Z");

    expect(progressLineOf(time, "Preflight passed in 5s.")).toBe(
      "2026-10-29 07:49:05 CDT Preflight passed in 5s.",
    );
  });

  it("round-trips a local-time line through the writer and parser", () => {
    const time = new Date("2026-10-29T12:49:05.000Z");

    const line = progressLineOf(time, "byro-repo #431: implement took 2903s.");

    expect(stampedLineOf(line)).toEqual({
      time,
      text: "byro-repo #431: implement took 2903s.",
    });
  });

  it("tells the repeated hour apart by its zone when the clocks go back", () => {
    const daylight = new Date("2026-11-01T06:30:00.000Z");
    const standard = new Date("2026-11-01T07:30:00.000Z");

    expect(progressLineOf(daylight, "a")).toBe("2026-11-01 01:30:00 CDT a");
    expect(progressLineOf(standard, "a")).toBe("2026-11-01 01:30:00 CST a");
    expect(stampedLineOf(progressLineOf(daylight, "a")).time).toEqual(daylight);
    expect(stampedLineOf(progressLineOf(standard, "a")).time).toEqual(standard);
  });

  it("reads a line another machine stamped with a GMT offset", () => {
    expect(stampedLineOf("2026-10-29 18:19:05 GMT+5:30 a").time).toEqual(
      new Date("2026-10-29T12:49:05.000Z"),
    );
  });

  it("still parses an older runner's UTC line", () => {
    expect(
      stampedLineOf("2026-10-25T11:00:05.000Z Preflight passed in 5s."),
    ).toEqual({
      time: new Date("2026-10-25T11:00:05.000Z"),
      text: "Preflight passed in 5s.",
    });
  });
});
