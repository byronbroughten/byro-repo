import { describe, expect, it } from "vitest";

import type { TicketState } from "../../SpecRun/runState.ts";
import { trackedIssues } from "../../specRunHarness/trackedIssues.ts";
import type { DraftedRecord } from "../../stepRecords.ts";
import { agentDraft } from "./agentDraft.ts";
import { pieceChecks } from "./pieceChecks.ts";

const sections = agentDraft.sectionsOf(
  "## The harbour\n<!-- developer -->\n\nGulls circled the quay at dawn.\n\n## The crossing\n<!-- agent -->\n\nThe ferry slipped out at noon.\n\n## The landing\n<!-- agent -->\n\nThey came ashore.\n",
);

const draftedRecord: DraftedRecord = {
  status: "committed",
  branches: [],
  closingComment: "",
  boxesUndone: [],
  blockers: [],
  sectionsDrafted: ["The landing"],
};

function scopeInputOf(labels: string[], record?: DraftedRecord) {
  const state: TicketState = {
    step: "checks",
    record,
    sessions: [],
    limitResumes: 0,
  };
  return { ticket: trackedIssues.issueOf(1, { labels, body: "" }), state };
}

function headingsOf(scope: { sections: { heading: string }[] }): string[] {
  return scope.sections.map(({ heading }) => heading);
}

describe("pieceChecks.scopeOf", () => {
  it("holds the agent Sections the record drafted, short of the whole draft", () => {
    const scope = pieceChecks.scopeOf(
      sections,
      scopeInputOf([], draftedRecord),
    );

    expect(headingsOf(scope)).toEqual(["The landing"]);
    expect(scope.isWhole).toBe(false);
  });

  it("holds every agent Section on a final pass, as the whole draft", () => {
    const scope = pieceChecks.scopeOf(
      sections,
      scopeInputOf(["final-pass"], draftedRecord),
    );

    expect(headingsOf(scope)).toEqual(["The crossing", "The landing"]);
    expect(scope.isWhole).toBe(true);
  });

  it("is the whole draft when the record drafted every Section", () => {
    const agentOnly = sections.filter(({ author }) => author === "agent");

    const scope = pieceChecks.scopeOf(
      agentOnly,
      scopeInputOf([], {
        ...draftedRecord,
        sectionsDrafted: ["The crossing", "The landing"],
      }),
    );

    expect(scope.isWhole).toBe(true);
  });

  it("never holds a developer's Section, even one the record names", () => {
    const scope = pieceChecks.scopeOf(
      sections,
      scopeInputOf([], { ...draftedRecord, sectionsDrafted: ["The harbour"] }),
    );

    expect(headingsOf(scope)).toEqual([]);
  });
});

describe("pieceChecks.lengthLimitOf", () => {
  it("reads the Form field's `Length:` line", () => {
    expect(
      pieceChecks.lengthLimitOf(
        "## Form\n\nAn essay.\nLength: 900 words\n\n## Reader\n\nA clerk.\n",
      ),
    ).toBe(900);
  });

  it("is undefined with no `Length:` line, or one outside the Form field", () => {
    expect(pieceChecks.lengthLimitOf("## Form\n\nAn essay.\n")).toBeUndefined();
    expect(
      pieceChecks.lengthLimitOf(
        "## Form\n\nAn essay.\n\n## Reader\n\nLength: 900 words\n",
      ),
    ).toBeUndefined();
  });
});

describe("pieceChecks.wordCountOf", () => {
  it("counts every Section's body words, headings and author marks left out", () => {
    expect(pieceChecks.wordCountOf(sections)).toBe(15);
  });
});
