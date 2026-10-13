import { describe, expect, it } from "vitest";

import { type PathEntry, trackedChangeSummary } from "./trackedChangeSummary.ts";

const path = "skills/engineering/implement";
const stat = "1 file changed, 3 insertions(+), 1 deletion(-)";

describe("trackedChangeSummary", () => {
  it("names the one fork of a changed path", () => {
    const entry: PathEntry = { status: "vendored", derivedInto: ["implement-piece"] };
    expect(trackedChangeSummary({ path, entry, commitCount: 2, stat })).toBe(
      `vendored       ${path}: 2 commit(s), ${stat}; forks: .claude/skills/implement-piece/`,
    );
  });

  it("names both forks of a changed path", () => {
    const entry: PathEntry = { status: "vendored", derivedInto: ["review-piece", "review-research"] };
    expect(trackedChangeSummary({ path, entry, commitCount: 1, stat })).toBe(
      `vendored       ${path}: 1 commit(s), ${stat}; forks: .claude/skills/review-piece/, .claude/skills/review-research/`,
    );
  });

  it("resolves a fork outside the skills folder to its repo path", () => {
    const entry: PathEntry = {
      status: "vendored",
      derivedInto: ["implement-piece", "runner/src/implementStep.ts"],
    };
    expect(trackedChangeSummary({ path, entry, commitCount: 1, stat })).toBe(
      `vendored       ${path}: 1 commit(s), ${stat}; forks: .claude/skills/implement-piece/, runner/src/implementStep.ts`,
    );
  });

  it("keeps the plain line for a path with no forks", () => {
    const entry: PathEntry = { status: "reference-only" };
    expect(trackedChangeSummary({ path, entry, commitCount: 3, stat })).toBe(
      `reference-only ${path}: 3 commit(s), ${stat}`,
    );
  });
});
