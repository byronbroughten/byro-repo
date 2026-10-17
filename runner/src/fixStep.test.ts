import { Ajv } from "ajv";
import { describe, expect, it } from "vitest";

import type { TriageRecord } from "./findingTriage.ts";
import {
  type FixOutcome,
  fixOutcomesOf,
  fixOutputSchema,
  fixPrompt,
  fixRecordProblems,
  giveUpRecordOf,
} from "./fixStep.ts";

// The same Ajv setup StepStream validates a step's structured output with.
const validateOutput = new Ajv({ allErrors: true, strict: false }).compile(
  fixOutputSchema,
);

function fixOf(finding: number, axis: TriageRecord["axis"]): TriageRecord {
  return {
    finding,
    axis,
    where: `runner/src/SpecRun.ts:${finding}`,
    claim: `Finding ${finding} is wrong.`,
    quote: `runner/src/SpecRun.ts:${finding} \`const x = 1;\``,
    rule: "config/docs/code-style.md: A comment is one line.",
    verdict: "fix",
    evidence: "Checked the line.",
  };
}

const fixed: FixOutcome = { finding: 1, status: "fixed" };
const gaveUp: FixOutcome = {
  finding: 2,
  status: "gave-up",
  reason: "judgement-call",
  note: "Either name reads fine; the developer should pick.",
};

describe("fixPrompt", () => {
  it("lists each Fix with its number, quote and rule, and asks for a separate commit", () => {
    const prompt = fixPrompt({
      issue: { repo: "byro-repo", number: 226 },
      title: "Run loop: finding triage and fixes",
      branch: "issue-226-run-loop",
      branchedRepos: ["byro-repo"],
      fixes: [fixOf(3, "standards")],
    });
    expect(prompt).toContain("Finding 3: Finding 3 is wrong.");
    expect(prompt).toContain("runner/src/SpecRun.ts:3 `const x = 1;`");
    expect(prompt).toContain(
      "Rule: config/docs/code-style.md: A comment is one line.",
    );
    expect(prompt).toContain("separate from the implement commit");
  });
});

describe("fixOutputSchema", () => {
  it("passes a fixed and a given-up outcome and reads them back", () => {
    const output = { outcomes: [fixed, gaveUp] };
    expect(validateOutput(output)).toBe(true);
    expect(fixOutcomesOf(output)).toEqual([fixed, gaveUp]);
  });

  it("refuses a give-up with a reason outside the two", () => {
    const output = { outcomes: [{ ...gaveUp, reason: "too-hard" }] };
    expect(validateOutput(output)).toBe(false);
  });
});

describe("fixRecordProblems", () => {
  const fixes = [fixOf(1, "standards"), fixOf(2, "spec")];

  it("passes one outcome per Fix with a commit for the fixed one", () => {
    expect(fixRecordProblems(fixes, [fixed, gaveUp], true)).toEqual([]);
  });

  it("passes all given up with no commit", () => {
    const outcomes: FixOutcome[] = [{ ...gaveUp, finding: 1 }, gaveUp];
    expect(fixRecordProblems(fixes, outcomes, false)).toEqual([]);
  });

  it("names a Fix with no outcome and an outcome for a finding not in the batch", () => {
    expect(
      fixRecordProblems(fixes, [fixed, { finding: 5, status: "fixed" }], true),
    ).toEqual([
      "finding 2: each Fix gets exactly one outcome, but it got 0",
      "finding 5: the batch has no Fix 5",
    ]);
  });

  it("refuses a fixed outcome with no new commit, and a new commit with nothing fixed", () => {
    expect(fixRecordProblems(fixes, [fixed, gaveUp], false)).toEqual([
      "the record says a finding was fixed, but the step made no new commit",
    ]);
    const allGaveUp: FixOutcome[] = [{ ...gaveUp, finding: 1 }, gaveUp];
    expect(fixRecordProblems(fixes, allGaveUp, true)).toEqual([
      "every Fix was given up, so its change is reverted, but the step made a new commit",
    ]);
  });
});

describe("giveUpRecordOf", () => {
  it("turns a spec-axis give-up into a Halt scoped to the downstream tickets", () => {
    expect(
      giveUpRecordOf(fixOf(2, "spec"), gaveUp, ["byro-repo#7"]),
    ).toMatchObject({
      verdict: "halt",
      reason: "judgement-call",
      haltScope: ["byro-repo#7"],
      recommendation:
        "The fixer gave up (judgement-call): Either name reads fine; the developer should pick.",
    });
  });

  it("turns a standards-axis give-up into a Defer `decision`", () => {
    expect(
      giveUpRecordOf(fixOf(2, "standards"), gaveUp, ["byro-repo#7"]),
    ).toMatchObject({
      verdict: "defer",
      reason: "decision",
      recommendation:
        "The fixer gave up (judgement-call): Either name reads fine; the developer should pick.",
    });
  });
});
