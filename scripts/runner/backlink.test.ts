import { describe, expect, it } from "vitest";

import { backlinkLineOf, withBacklink } from "./backlink.ts";

const line =
  "Design decision: byronbroughten/byro-repo/docs/adr/0007-issue-reader.md";

describe("backlinkLineOf", () => {
  it("builds the line from a repo-relative ADR path", () => {
    expect(
      backlinkLineOf(
        "byronbroughten/byro-repo",
        "docs/adr/0007-issue-reader.md",
      ),
    ).toBe(line);
  });

  it("keeps only the docs/adr tail of a path from the workspace root", () => {
    expect(
      backlinkLineOf(
        "byronbroughten/sheets-framework",
        "packages/framework/docs/adr/0010-queued-writes.md",
      ),
    ).toBe(
      "Design decision: byronbroughten/sheets-framework/docs/adr/0010-queued-writes.md",
    );
  });

  it("refuses a path that isn't an ADR", () => {
    expect(() =>
      backlinkLineOf("byronbroughten/byro-repo", "docs/agents/jev.md"),
    ).toThrow("docs/adr/NNNN-slug.md");
  });
});

describe("withBacklink", () => {
  it("appends the line to a body as its own paragraph", () => {
    expect(withBacklink("## Problem\n\nText.", line)).toBe(
      `## Problem\n\nText.\n\n${line}`,
    );
  });

  it("returns a body already ending with the line unchanged", () => {
    const body = `Text.\n\n${line}`;

    expect(withBacklink(body, line)).toBe(body);
  });

  it("treats a trailing newline as the end of the body", () => {
    expect(withBacklink("Text.\n", line)).toBe(`Text.\n\n${line}`);
    expect(withBacklink(`Text.\n\n${line}\n`, line)).toBe(`Text.\n\n${line}\n`);
  });
});
