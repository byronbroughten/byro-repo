import { describe, expect, it } from "vitest";

import type { ResolveRecord } from "../../stepRecords.ts";
import { pieceReviewCaughtOf, type RuleSheets } from "./reviewCaught.ts";

const sheets: RuleSheets = {
  Voice:
    "## Axes\n\n- **Evidence**: a setting.\n- **Academic**: a setting.\n\n## Numbers\n\n- **Open a section on its claim.** Then support it.\n- `formal` **Write no contractions.**\n",
  Craft:
    "## Terms\n\n- **One idea per sentence.** Split a sentence that carries two.\n- **Given before new**: the order.\n",
  academic: "- **Quote nothing; paraphrase every borrowed fact.**\n",
};

function recordOf(fields: Partial<ResolveRecord>): ResolveRecord {
  return {
    finding: 1,
    axis: "standards",
    where: "## Private heading",
    claim: "The sentence about my private matter runs on.",
    quote: "A private sentence from the draft.",
    verdict: "fix",
    evidence: "Split it.",
    ...fields,
  };
}

describe("pieceReviewCaughtOf", () => {
  it("lists each Fix by axis and cited rule, counted, with no claim, quote or heading", () => {
    const caught = pieceReviewCaughtOf(
      [
        recordOf({ rule: 'Craft "One idea per sentence"' }),
        recordOf({ rule: "writing-craft.md: one idea per sentence." }),
        recordOf({ axis: "reader", rule: "The spec's Reader line" }),
      ],
      sheets,
    );

    expect(caught).toBe(
      'Fixed: standards, Craft "One idea per sentence" ×2; reader, spec Reader line ×1',
    );
  });

  it("writes any other rule as spec, since a cited spec line can carry private prose", () => {
    const caught = pieceReviewCaughtOf(
      [
        recordOf({ axis: "spec", rule: "The draft says my landlord lied." }),
        recordOf({ axis: "spec" }),
      ],
      sheets,
    );

    expect(caught).toBe("Fixed: spec, spec ×2");
  });

  it("names a rule the sheet tags with an axis value", () => {
    const caught = pieceReviewCaughtOf(
      [recordOf({ rule: "Voice: write no contractions." })],
      sheets,
    );

    expect(caught).toBe('Fixed: standards, Voice "Write no contractions" ×1');
  });

  it("names no Axes bullet as a rule, and holds a field label only as a field reference", () => {
    const caught = pieceReviewCaughtOf(
      [
        recordOf({ axis: "spec", rule: "Evidence of the lease breach" }),
        recordOf({ axis: "spec", rule: "My landlord's form was forged" }),
      ],
      sheets,
    );

    expect(caught).toBe("Fixed: spec, spec ×2");
  });

  it("words Proposals and Halts the same way, leaving Dismissals out", () => {
    const caught = pieceReviewCaughtOf(
      [
        recordOf({ verdict: "dismiss", rule: "Voice" }),
        recordOf({
          verdict: "propose",
          rule: "Academic sheet: quote nothing; paraphrase every borrowed fact.",
        }),
        recordOf({ verdict: "halt", axis: "spec", rule: "Outline" }),
      ],
      sheets,
    );

    expect(caught).toBe(
      'Proposed: standards, academic "Quote nothing; paraphrase every borrowed fact" ×1. Halted: spec, spec Outline line ×1',
    );
  });

  it("is undefined when review kept nothing", () => {
    expect(
      pieceReviewCaughtOf([recordOf({ verdict: "dismiss" })], sheets),
    ).toBeUndefined();
  });
});
