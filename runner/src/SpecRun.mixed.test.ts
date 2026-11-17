import { describe, expect, it } from "vitest";

import { Docs } from "./Docs.ts";
import { FakeAgentStep } from "./FakeAgentStep.ts";
import type { RunResult } from "./SpecRun.ts";
import {
  addSpec,
  commentsOn,
  gapCheckCount,
  gapCheckMark,
  github,
  heldDocs,
  holdDocs,
  implemented,
  progressLines,
  resultOf,
  reviewed,
  spec,
  specRun,
  type StepScript,
  ticketState,
  useSpecRunHarness,
} from "./specRunHarness.ts";
import { pieceDrafts } from "./specRunHarness/pieceDrafts.ts";

useSpecRunHarness();

const { deliverableId, docOf, drafted, pieceReviewed } = pieceDrafts;

const gap = {
  ask: "Story 3: the harbour at dusk",
  evidence: "No Section of the Agent draft sets the harbour at dusk.",
  recommendation: "Draft it in a further ticket.",
  draftIssueTitle: "Draft the harbour at dusk",
};
// The piece section of the gap check's prompt says it; the code one doesn't.
const pieceGapCheckLine = "only what no review checks";
const codeGapCheckHeading = "## The code tickets' work: master";

// The crossing is the agents', and differs from the Doc, so the push writes it.
const crossingDraft =
  "## The harbour\n<!-- developer -->\n\nGulls circled the quay at dawn.\n\n## The crossing\n<!-- agent -->\n\nThe ferry carried them away at noon.\n";

function gapChecked(gaps: object[]): StepScript {
  return async () => resultOf({ gaps });
}

describe("a `code` spec with a `piece` ticket", () => {
  // Ticket 1 drafts, ticket 2 is a code ticket and ticket 3 is the piece ticket's Edit gate.
  function addMixedSpec(): void {
    addSpec([1, 2, 3]);
    github.edit(spec.number, {
      labels: ["code"],
      body: `## Deliverable\n\nThe crossing, doc ${deliverableId}.\n`,
    });
    holdDocs(
      docOf({
        "The harbour": "Gulls circled the quay at dawn.",
        "The crossing": "The ferry left late.",
      }),
    );
    github.edit(1, { labels: ["ready-for-agent", "piece"] });
    github.edit(2, { labels: ["ready-for-agent", "code"] });
    github.edit(3, { labels: ["ready-for-human", "piece"] });
  }

  async function runsToItsEnd(
    gaps: object[],
  ): Promise<{ result: RunResult; agentStep: FakeAgentStep }> {
    const agentStep = FakeAgentStep.init(
      drafted({}, crossingDraft),
      pieceReviewed([], []),
      implemented("two.ts"),
      reviewed(),
      gapChecked(gaps),
    );
    const result = await specRun(agentStep, { agentStep }).run(spec);
    return { result, agentStep };
  }

  async function crossingInTheDoc(): Promise<string | undefined> {
    const read = await Docs.init(heldDocs()).read(deliverableId);
    return read.sections.get("The crossing");
  }

  it("runs the piece Steps for its piece ticket and the code Steps for its code ticket", async () => {
    addMixedSpec();

    const { agentStep } = await runsToItsEnd([]);

    const [, pieceReview, , codeReview] = agentStep.requests;
    expect(pieceReview?.prompt).toContain(
      "Three-axis review of a Piece's Agent draft",
    );
    expect(codeReview?.prompt).toContain("Two-axis review");
    expect(ticketState()["byro-repo #1"]?.step).toBe("landed");
    expect(ticketState()["byro-repo #2"]?.step).toBe("landed");
  });

  it("runs one gap check over both Workflows' sections, past the open Edit gate, and posts one gap-check review list", async () => {
    addMixedSpec();

    const { agentStep } = await runsToItsEnd([gap]);

    expect(gapCheckCount(agentStep)).toBe(1);
    const prompt = agentStep.requests.at(-1)?.prompt;
    expect(prompt).toContain(pieceGapCheckLine);
    expect(prompt).toContain(codeGapCheckHeading);
    const lists = commentsOn(spec.number, gapCheckMark);
    expect(lists).toHaveLength(1);
    expect(lists[0]).toContain(gap.ask);
  });

  it("ends on the Judge Step, writing nothing, while a review-list item is undecided", async () => {
    addMixedSpec();

    const { result } = await runsToItsEnd([gap]);

    expect(result.kind).toBe("stopped");
    expect(result.message).toContain("judge, then rerun");
    expect(await crossingInTheDoc()).toBe("The ferry left late.\n");
  });

  it("pushes the Agent draft and ends waiting on the Edit gate once every item is decided", async () => {
    addMixedSpec();

    const { result } = await runsToItsEnd([]);

    expect(await crossingInTheDoc()).toBe(
      "The ferry carried them away at noon.\n",
    );
    expect(result.kind).toBe("finished");
    expect(result.message).toContain("byro-repo #3 waits on you");
    expect(result.message).toContain(
      `\`/close-project byro-repo ${spec.number}\``,
    );
  });
});

describe("a spec labelled both kinds whose tickets are all `code`", () => {
  function addBothSpec(ticketTwoLabels: string[]): void {
    addSpec([1, 2]);
    github.edit(spec.number, { labels: ["code", "piece"] });
    github.edit(1, { labels: ["ready-for-agent", "code"] });
    github.edit(2, { labels: ticketTwoLabels });
  }

  it("ends as a code spec does: the code gap check once every ticket closes, and no push", async () => {
    addBothSpec(["ready-for-agent", "code"]);
    const agentStep = FakeAgentStep.init(
      implemented("one.ts"),
      reviewed(),
      implemented("two.ts"),
      reviewed(),
      gapChecked([]),
    );

    const result = await specRun(agentStep, { agentStep }).run(spec);

    expect(gapCheckCount(agentStep)).toBe(1);
    const prompt = agentStep.requests.at(-1)?.prompt;
    expect(prompt).not.toContain(pieceGapCheckLine);
    expect(prompt).toContain(codeGapCheckHeading);
    expect(commentsOn(spec.number, gapCheckMark)).toHaveLength(1);
    expect(progressLines().join("\n")).not.toContain("push");
    expect(result.kind).toBe("finished");
    expect(result.message).toContain("Every ticket is closed.");
  });

  it("holds the gap check while a code ticket waits on the developer", async () => {
    addBothSpec(["ready-for-human", "code"]);
    const agentStep = FakeAgentStep.init(implemented("one.ts"), reviewed());

    await specRun(agentStep, { agentStep }).run(spec);

    expect(gapCheckCount(agentStep)).toBe(0);
    expect(commentsOn(spec.number, gapCheckMark)).toEqual([]);
  });
});
