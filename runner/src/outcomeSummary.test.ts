import { describe, expect, it } from "vitest";

import {
  type OutcomeRowFile,
  outcomeSummaryOf,
  type SectionSelection,
} from "./outcomeSummary.ts";

const currentHeader = [
  "Issue",
  "Pair",
  "Account",
  "Files changed",
  "Peak context",
  "Result",
  "Proposals",
  "Review rounds",
  "Retries",
  "Duration",
  "Cost (API-equivalent)",
  "Review cost",
  "What review caught",
  "Session ids",
];

interface RowCells {
  issue: number;
  files?: string;
  peak?: string;
  result?: string;
  retries?: string;
  duration?: string;
  cost?: string;
  reviewCost?: string;
  sessions?: string;
}

function currentCellsOf(row: RowCells): string[] {
  return [
    `#${row.issue}`,
    "Opus medium",
    "1",
    row.files ?? "4",
    row.peak ?? "100K",
    row.result ?? "Pass",
    "0",
    "1",
    row.retries ?? "0",
    row.duration ?? "20 min",
    row.cost ?? "$4.00",
    row.reviewCost ?? "$1.00",
    "—",
    row.sessions ?? `s${row.issue}`,
  ];
}

function rowFileOf(
  section: string,
  repo: string,
  row: RowCells,
  landedAt = "2026-10-01T00:00:00Z",
): OutcomeRowFile {
  return tableFileOf({
    path: `${section}/${repo}-${row.issue}.md`,
    header: currentHeader,
    cells: currentCellsOf(row),
    landedAt,
  });
}

function tableFileOf({
  path,
  header,
  cells,
  landedAt = "2026-10-01T00:00:00Z",
}: {
  path: string;
  header: string[];
  cells: string[];
  landedAt?: string;
}): OutcomeRowFile {
  const line = (values: string[]) => `| ${values.join(" | ")} |`;
  return {
    path,
    text: [
      "# outcome",
      "",
      "Spec: [x](https://example.com)",
      "",
      line(header),
      line(header.map(() => "---")),
      line(cells),
      "",
    ].join("\n"),
    landedAt: new Date(landedAt),
  };
}

function summaryOf(
  rowFiles: OutcomeRowFile[],
  selection: SectionSelection = { all: true },
  hasTranscript: (sessionId: string) => boolean = () => true,
): Promise<string> {
  return outcomeSummaryOf({
    rowFiles,
    selection,
    outcomeFolder: "docs/agents/outcomes",
    ticketBudget: 150_000,
    modelFitOf: async ({ repo, number }) =>
      `Opus medium: ${repo}#${number}'s reason`,
    hasTranscript,
  });
}

function lineOf(summary: string, start: string): string | undefined {
  return summary.split("\n").find((line) => line.startsWith(start));
}

describe("review's share of cost", () => {
  it("gives the batch, each repo and each spec its share and row count", async () => {
    const summary = await summaryOf([
      rowFileOf("byro-repo-1", "byro-repo", {
        issue: 2,
        cost: "$3.00",
        reviewCost: "$1.00",
      }),
      rowFileOf("byro-repo-1", "personal", {
        issue: 3,
        cost: "$1.00",
        reviewCost: "$1.00",
      }),
      rowFileOf("byro-repo-5", "byro-repo", {
        issue: 6,
        cost: "$5.00",
        reviewCost: "$3.00",
      }),
    ]);

    expect(lineOf(summary, "- Batch:")).toBe("- Batch: 36% (3 rows)");
    expect(lineOf(summary, "- Repo byro-repo:")).toBe(
      "- Repo byro-repo: 33% (2 rows)",
    );
    expect(lineOf(summary, "- Repo personal:")).toBe(
      "- Repo personal: 50% (1 row)",
    );
    expect(lineOf(summary, "- Spec byro-repo#1:")).toBe(
      "- Spec byro-repo#1: 33% (2 rows)",
    );
    expect(lineOf(summary, "- Spec byro-repo#5:")).toBe(
      "- Spec byro-repo#5: 38% (1 row)",
    );
  });

  it("leaves out unrecorded costs and rows with a Triage cost column", async () => {
    const summary = await summaryOf([
      rowFileOf("byro-repo-1", "byro-repo", {
        issue: 2,
        cost: "$3.00",
        reviewCost: "$1.00",
      }),
      rowFileOf("byro-repo-1", "byro-repo", { issue: 3, cost: "unrecorded" }),
      tableFileOf({
        path: "byro-repo-1/byro-repo-4.md",
        header: olderHeader,
        cells: olderCellsOf(4, "Pass"),
      }),
    ]);

    expect(lineOf(summary, "- Batch:")).toBe("- Batch: 25% (1 row)");
  });
});

const olderHeader = [
  "Issue",
  "Pair",
  "Account",
  "Files changed",
  "Peak context",
  "Result",
  "Defers",
  "Review rounds",
  "Retries",
  "Duration",
  "Cost (API-equivalent)",
  "Triage cost",
  "Limit used",
  "What review caught",
  "Session ids",
];

function olderCellsOf(issue: number, result: string): string[] {
  return [
    `#${issue}`,
    "Opus medium",
    "2",
    "16",
    "162K → 131K",
    result,
    "0",
    "1",
    "0",
    "31 min",
    "$5.17",
    "$0.00",
    "40%",
    "—",
    `s${issue}`,
  ];
}

describe("older row formats", () => {
  it("reads each older Result under its current name", async () => {
    const summary = await summaryOf(
      ["Fix", "Triage fix", "Handoff fix"].map((result, index) =>
        tableFileOf({
          path: `byro-repo-1/byro-repo-${index + 2}.md`,
          header: olderHeader,
          cells: olderCellsOf(index + 2, result),
        }),
      ),
    );

    expect(summary).toContain(
      "| byro-repo#2 | Opus medium | 16 | 162K → 131K | 293K | Fix (resumed implementer) | 0 | 31 min | $5.17 | Triage cost column |",
    );
    expect(lineOf(summary, "- byro-repo#3:")).toMatch(
      /^- byro-repo#3: Result Fix \(fresh resolver\);/,
    );
    expect(lineOf(summary, "- byro-repo#4:")).toMatch(
      /^- byro-repo#4: Result Fix \(fresh resolver\);/,
    );
  });
});

describe("medians", () => {
  it("pools each repo's rows across the batch's specs, leaving out unrecorded figures", async () => {
    const summary = await summaryOf([
      rowFileOf("byro-repo-1", "byro-repo", {
        issue: 2,
        files: "2",
        duration: "10 min",
        cost: "$2.00",
      }),
      rowFileOf("byro-repo-5", "byro-repo", {
        issue: 6,
        files: "4",
        duration: "40 min",
        cost: "unrecorded",
      }),
      rowFileOf("byro-repo-5", "byro-repo", {
        issue: 7,
        files: "0",
        duration: "5 min",
        cost: "$1.00",
      }),
      rowFileOf("byro-repo-5", "personal", {
        issue: 8,
        files: "1",
        duration: "unrecorded",
        cost: "$3.00",
      }),
    ]);

    expect(lineOf(summary, "- Repo byro-repo: Duration")).toBe(
      "- Repo byro-repo: Duration 7.5 min per file (2 rows); Cost $1.00 per file (1 row)",
    );
    expect(lineOf(summary, "- Repo personal: Duration")).toBe(
      "- Repo personal: Duration no row records it; Cost $3.00 per file (1 row)",
    );
  });
});

describe("outliers", () => {
  function outliersOf(summary: string, spec: string): string[] {
    const section = summary.split(`## Spec ${spec}\n`)[1] ?? "";
    const outliers = section.split("Outliers:\n\n")[1] ?? "";
    return outliers.split("\n\n")[0]?.split("\n") ?? [];
  }

  it("names every rule each row trips, under its spec", async () => {
    const summary = await summaryOf(
      [
        rowFileOf("byro-repo-1", "byro-repo", {
          issue: 2,
          result: "Fix (resumed implementer)",
          retries: "1",
        }),
        rowFileOf("byro-repo-1", "byro-repo", {
          issue: 3,
          result: "Halted then passed (verdict Halt)",
          peak: "120K → 90K",
        }),
        rowFileOf("byro-repo-5", "byro-repo", {
          issue: 6,
          result: "Fix (fresh resolver)",
          sessions: "a, b",
        }),
        rowFileOf("byro-repo-5", "byro-repo", { issue: 7 }),
      ],
      { all: true },
      (sessionId) => sessionId !== "b",
    );

    expect(outliersOf(summary, "byro-repo#1")).toEqual([
      "- byro-repo#2: Result Fix (resumed implementer); Retries 1. Sessions: s2.",
      "- byro-repo#3: Result Halted then passed (verdict Halt); over budget (peak sum 210K > 150K). Sessions: s3.",
    ]);
    expect(outliersOf(summary, "byro-repo#5")).toEqual([
      "- byro-repo#6: Result Fix (fresh resolver). Sessions: a, b (missing b).",
    ]);
  });

  it("flags a row long or costly against its repo's median over the batch", async () => {
    const summary = await summaryOf([
      rowFileOf("byro-repo-1", "byro-repo", { issue: 2 }),
      rowFileOf("byro-repo-1", "byro-repo", { issue: 3 }),
      rowFileOf("byro-repo-5", "byro-repo", {
        issue: 6,
        duration: "100 min",
        cost: "$40.00",
      }),
      rowFileOf("byro-repo-5", "personal", { issue: 7 }),
    ]);

    expect(outliersOf(summary, "byro-repo#5")).toEqual([
      "- byro-repo#6: long for its size (25 min per file, over twice the repo median 5 min); costly for its size ($10.00 per file, over twice the repo median $1.00). Sessions: s6.",
    ]);
  });

  it("flags nothing for size on fewer than three rows recording the figure", async () => {
    const summary = await summaryOf([
      rowFileOf("byro-repo-1", "byro-repo", { issue: 2 }),
      rowFileOf("byro-repo-1", "byro-repo", {
        issue: 3,
        duration: "100 min",
        cost: "$40.00",
      }),
      rowFileOf("byro-repo-1", "byro-repo", {
        issue: 4,
        duration: "unrecorded",
        cost: "unrecorded",
      }),
    ]);

    expect(outliersOf(summary, "byro-repo#1")).toEqual(["None."]);
  });
});

describe("transcripts", () => {
  it("classifies expired, partly expired and never-recorded rows", async () => {
    const summary = await summaryOf(
      [
        rowFileOf("byro-repo-1", "byro-repo", { issue: 2, sessions: "a, b" }),
        rowFileOf("byro-repo-1", "byro-repo", { issue: 3, sessions: "c, d" }),
        rowFileOf("byro-repo-1", "byro-repo", {
          issue: 4,
          sessions: "unrecorded",
        }),
        rowFileOf("byro-repo-1", "byro-repo", { issue: 5, sessions: "e" }),
      ],
      { all: true },
      (sessionId) => ["c", "e"].includes(sessionId),
    );

    expect(lineOf(summary, "- Expired:")).toBe("- Expired: byro-repo#2");
    expect(lineOf(summary, "- Partly expired:")).toBe(
      "- Partly expired: byro-repo#3 (missing d)",
    );
    expect(lineOf(summary, "- Never recorded:")).toBe(
      "- Never recorded: byro-repo#4",
    );
  });
});

describe("Model fit", () => {
  it("gives each ticket's Model fit under its spec", async () => {
    const summary = await summaryOf([
      rowFileOf("byro-repo-1", "personal", { issue: 2 }),
    ]);

    expect(lineOf(summary, "- personal#2: Opus medium")).toBe(
      "- personal#2: Opus medium: personal#2's reason",
    );
  });
});

describe("which sections", () => {
  const rowFiles = [
    rowFileOf("byro-repo-1", "byro-repo", { issue: 2 }, "2026-10-05T00:00:00Z"),
    rowFileOf("byro-repo-1", "byro-repo", { issue: 3 }, "2026-09-01T00:00:00Z"),
    rowFileOf("byro-repo-5", "byro-repo", { issue: 6 }, "2026-10-03T00:00:00Z"),
    rowFileOf("writing-9", "writing", { issue: 10 }, "2026-10-04T00:00:00Z"),
    tableFileOf({
      path: "legacy.md",
      header: ["Issue", "Pair", "Files changed", "Peak context", "Result"],
      cells: ["#194", "Opus medium", "14", "121K", "Pass"],
      landedAt: "2026-10-30T00:00:00Z",
    }),
  ];

  function specsOf(summary: string): string[] {
    return summary
      .split("\n")
      .filter((line) => line.startsWith("## Spec "))
      .map((line) => line.slice("## Spec ".length));
  }

  it("takes the N sections whose newest row landed most recently", async () => {
    const summary = await summaryOf(rowFiles, { recent: 2 });

    expect(specsOf(summary)).toEqual(["byro-repo#1", "writing#9"]);
  });

  it("takes every section with --all, leaving the legacy log out", async () => {
    const summary = await summaryOf(rowFiles, { all: true });

    expect(specsOf(summary)).toEqual([
      "byro-repo#1",
      "writing#9",
      "byro-repo#5",
    ]);
    expect(summary).not.toContain("#194");
  });

  it("takes one section by its folder or spec name", async () => {
    expect(
      specsOf(await summaryOf(rowFiles, { section: "byro-repo-5" })),
    ).toEqual(["byro-repo#5"]);
    expect(
      specsOf(await summaryOf(rowFiles, { section: "writing#9" })),
    ).toEqual(["writing#9"]);
  });

  it("refuses a section with no folder", async () => {
    await expect(
      summaryOf(rowFiles, { section: "byro-repo-99" }),
    ).rejects.toThrow("No outcome section named byro-repo-99");
  });
});
