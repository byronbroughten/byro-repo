import { describe, expect, it } from "vitest";

import { pieceImplementRecordProblems } from "./implementStep.ts";

const draft =
  "## The harbour\n<!-- developer -->\n\nGulls circled the quay at dawn.\n\n## The crossing\n<!-- agent -->\n\nThe ferry slipped out at noon.\n";

function outputOf(sectionsDrafted: string[]) {
  return {
    record: {
      status: "committed",
      branches: [{ repo: "byro-repo", branch: "issue-1-a", sha: "abc123" }],
      sectionsDrafted,
      closingComment: "Drafted.",
      boxesUndone: [],
      blockers: [],
    },
  };
}

function contextOf(isFinalPass: boolean) {
  return { isFinalPass, draftOf: () => draft };
}

describe("pieceImplementRecordProblems", () => {
  it("passes a record whose sectionsDrafted all name Sections the draft holds", () => {
    expect(
      pieceImplementRecordProblems(
        outputOf(["The crossing"]),
        true,
        contextOf(false),
      ),
    ).toEqual([]);
  });

  it("returns a heading the draft lacks as a record problem naming it", () => {
    const problems = pieceImplementRecordProblems(
      outputOf(["The crossing", "The crosing"]),
      true,
      contextOf(false),
    );

    expect(problems).toHaveLength(1);
    expect(problems[0]).toContain("The crosing");
    expect(problems[0]).not.toContain("The crossing");
  });

  it("leaves a final-pass ticket's record unchecked, since it scopes every agent Section", () => {
    expect(
      pieceImplementRecordProblems(
        outputOf(["The crosing"]),
        true,
        contextOf(true),
      ),
    ).toEqual([]);
  });

  it("never reads the draft for a record that committed nothing", () => {
    const blocked = {
      record: {
        status: "blocked",
        branches: [],
        closingComment: "Stopped.",
        boxesUndone: [],
        blockers: [
          { kind: "spec-ambiguity", detail: "d", recommendation: "r" },
        ],
      },
    };

    expect(
      pieceImplementRecordProblems(blocked, false, {
        isFinalPass: false,
        draftOf() {
          throw new Error("read the draft");
        },
      }),
    ).toEqual([]);
  });

  it("keeps the commit check ahead of the heading check", () => {
    expect(
      pieceImplementRecordProblems(
        outputOf(["The crosing"]),
        false,
        contextOf(false),
      ),
    ).toEqual(["the record says committed, but the step made no new commit"]);
  });
});
