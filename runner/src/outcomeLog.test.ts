import { describe, expect, it } from "vitest";

import {
  outcomeCommitMessage,
  outcomeFileOf,
  type OutcomeRow,
  peakContextOf,
} from "./outcomeLog.ts";

const row: OutcomeRow = {
  issue: { repo: "byro-repo", number: 218 },
  spec: { repo: "byro-repo", number: 213 },
  githubOwner: "byronbroughten",
  filesChanged: 7,
  facts: {},
};

function cellsOf(file: string): string[] {
  const rowLine = file.split("\n")[6] ?? "";
  return rowLine.slice(2, -2).split(" | ");
}

describe("outcomeFileOf", () => {
  it("writes every fact nobody passed as unrecorded, and the runner's facts as their standalone defaults", () => {
    expect(cellsOf(outcomeFileOf(row))).toEqual([
      "#218",
      "unrecorded",
      "unrecorded",
      "7",
      "unrecorded",
      "unrecorded",
      "0",
      "1",
      "0",
      "unrecorded",
      "unrecorded",
      "unrecorded",
      "unrecorded",
      "unrecorded",
    ]);
  });

  it("writes passed and computed facts", () => {
    const cells = cellsOf(
      outcomeFileOf({
        ...row,
        facts: {
          pair: "Sonnet high",
          account: "2",
          peakContext: [121_400],
          halt: "red checks",
          proposals: 2,
          reviewRounds: 1,
          retries: 1,
          durationMinutes: 42,
          costUsd: 3.5,
          reviewCostUsd: 0.4,
          whatReviewCaught: "A | in a cell",
          sessionIds: ["a1", "b2"],
        },
      }),
    );
    expect(cells).toEqual([
      "#218",
      "Sonnet high",
      "2",
      "7",
      "121K",
      "Halted then passed (red checks)",
      "2",
      "1",
      "1",
      "42 min",
      "$3.50",
      "$0.40",
      "A \\| in a cell",
      "a1, b2",
    ]);
  });

  it("writes unrecorded for what review caught when review fixes were needed but it went unsaid", () => {
    const cells = cellsOf(
      outcomeFileOf({ ...row, facts: { reviewFixes: "implementer" } }),
    );
    expect([cells[5], cells[12]]).toEqual([
      "Fix (resumed implementer)",
      "unrecorded",
    ]);
  });

  it("writes a ticket with no code as review skipped, with nothing caught", () => {
    const cells = cellsOf(
      outcomeFileOf({ ...row, facts: { reviewFixes: "skipped" } }),
    );
    expect([cells[5], cells[12]]).toEqual(["skipped (no code)", "—"]);
  });
});

describe("peakContextOf", () => {
  it("lists each implementer session's peak in order", () => {
    expect(peakContextOf({ peakContext: [150_000, 90_000] })).toBe(
      "150K → 90K",
    );
  });
});

describe("outcomeCommitMessage", () => {
  it("says which resolver fixed a reviewed ticket", () => {
    expect(
      outcomeCommitMessage({
        ...row,
        facts: {
          pair: "Opus medium",
          peakContext: [80_000],
          reviewFixes: "fresh",
        },
      }),
    ).toBe(
      "Record the #218 outcome: Opus medium, 7 files, 80K, fixed after review by a fresh resolver.",
    );
  });

  it("says a ticket with no code skipped review", () => {
    expect(
      outcomeCommitMessage({
        ...row,
        filesChanged: 0,
        facts: { pair: "Opus medium", reviewFixes: "skipped" },
      }),
    ).toBe(
      "Record the #218 outcome: Opus medium, 0 files, unrecorded, review skipped (no code).",
    );
  });
});
