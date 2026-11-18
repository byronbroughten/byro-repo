import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { sizeReportOf } from "./sizeReport.ts";

// Each file is lines of 100 characters, newline included.
const fixtureLines = {
  "src/big.ts": 40,
  "src/sub/deep.ts": 10,
  "src/ignored.ts": 6,
  "docs/same.md": 26,
  "docs/same.ts": 26,
};

const nonIgnoredFiles = [
  "docs/same.md",
  "docs/same.ts",
  "src/big.ts",
  "src/sub/deep.ts",
];

let root = "";

beforeAll(() => {
  root = mkdtempSync(join(tmpdir(), "size-report-"));
  for (const [path, lineCount] of Object.entries(fixtureLines)) {
    mkdirSync(dirname(join(root, path)), { recursive: true });
    writeFileSync(join(root, path), `${"x".repeat(99)}\n`.repeat(lineCount));
  }
});

afterAll(() => {
  rmSync(root, { recursive: true, force: true });
});

function reportOf(...args: string[]): string {
  return sizeReportOf({ root, files: nonIgnoredFiles, args });
}

describe("sizeReportOf", () => {
  it("lists each file largest first by estimated tokens, then a total row", () => {
    expect(reportOf("src", "docs")).toBe(
      [
        "file             characters  lines  tokens",
        "src/big.ts       4000        40     ~2.0K",
        "docs/same.ts     2600        26     ~1.3K",
        "docs/same.md     2600        26     ~1.0K",
        "src/sub/deep.ts  1000        10     ~0.5K",
        "total (4 files)  10200       102    ~4.8K",
        "",
      ].join("\n"),
    );
  });

  it("prints only the total row with --total", () => {
    expect(reportOf("--total", "src")).toBe(
      "total (2 files)  5000  50  ~2.5K\n",
    );
  });

  it("leaves a file out of the non-ignored list out of a directory, but counts it when named", () => {
    expect(reportOf("--total", "src")).not.toContain("3 files");
    expect(reportOf("src/ignored.ts")).toBe(
      [
        "file            characters  lines  tokens",
        "src/ignored.ts  600         6      ~0.3K",
        "total (1 file)  600         6      ~0.3K",
        "",
      ].join("\n"),
    );
  });

  it("expands a glob against the non-ignored list", () => {
    expect(reportOf("**/*.ts")).toBe(
      [
        "file             characters  lines  tokens",
        "src/big.ts       4000        40     ~2.0K",
        "docs/same.ts     2600        26     ~1.3K",
        "src/sub/deep.ts  1000        10     ~0.5K",
        "total (3 files)  7600        76     ~3.8K",
        "",
      ].join("\n"),
    );
  });

  it("counts a file matched by two arguments once", () => {
    expect(reportOf("--total", "src", "./src/big.ts", "src/**")).toBe(
      "total (2 files)  5000  50  ~2.5K\n",
    );
  });

  it("estimates prose at a lower token cost than code of equal length", () => {
    expect(reportOf("--total", "docs/same.md")).toBe(
      "total (1 file)  2600  26  ~1.0K\n",
    );
    expect(reportOf("--total", "docs/same.ts")).toBe(
      "total (1 file)  2600  26  ~1.3K\n",
    );
  });

  it("refuses an argument that matches no file, naming it", () => {
    expect(() => reportOf("src", "nope/*.ts")).toThrow(
      "nope/*.ts matches no file",
    );
  });

  it("refuses a run naming no file, and an unknown flag", () => {
    expect(() => reportOf("--total")).toThrow("no file named");
    expect(() => reportOf("--totals", "src")).toThrow("unknown flag --totals");
  });
});
