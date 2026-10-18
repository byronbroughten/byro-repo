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

  it("runs npm run check after committing, and fixes a failing check in a further commit", () => {
    const prompt = fixPrompt({
      issue: { repo: "byro-repo", number: 226 },
      title: "Run loop: finding triage and fixes",
      branch: "issue-226-run-loop",
      branchedRepos: ["byro-repo"],
      fixes: [fixOf(3, "standards")],
    });
    expect(prompt).toContain(
      "Once the fixes are in, commit, then run `npm run check`. When it fails on a fix, fix it in a further commit and run it again.",
    );
    expect(prompt).not.toContain("Commit once");
  });

  it("settles a tie by picking one fix, and keeps judgement-call for a spec reversal", () => {
    const prompt = fixPrompt({
      issue: { repo: "byro-repo", number: 291 },
      title: "Smells are fixed by default",
      branch: "issue-291-smells",
      branchedRepos: ["byro-repo"],
      fixes: [fixOf(1, "standards")],
    });
    expect(prompt).toContain("pick one and say which in the commit message");
    expect(prompt).toContain(
      "`judgement-call` only when the fix would reverse a spec decision",
    );
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
    expect(
      fixRecordProblems({
        fixes,
        outcomes: [fixed, gaveUp],
        hasNewCommit: true,
        dirtyRepos: [],
      }),
    ).toEqual([]);
  });

  it("passes all given up with no commit", () => {
    const outcomes: FixOutcome[] = [{ ...gaveUp, finding: 1 }, gaveUp];
    expect(
      fixRecordProblems({
        fixes,
        outcomes: outcomes,
        hasNewCommit: false,
        dirtyRepos: [],
      }),
    ).toEqual([]);
  });

  it("names a Fix with no outcome and an outcome for a finding not in the batch", () => {
    expect(
      fixRecordProblems({
        fixes,
        outcomes: [fixed, { finding: 5, status: "fixed" }],
        hasNewCommit: true,
        dirtyRepos: [],
      }),
    ).toEqual([
      "finding 2: each Fix gets exactly one outcome, but it got 0",
      "finding 5: the batch has no Fix 5",
    ]);
  });

  it("refuses a fixed outcome with no new commit, and a new commit with nothing fixed", () => {
    expect(
      fixRecordProblems({
        fixes,
        outcomes: [fixed, gaveUp],
        hasNewCommit: false,
        dirtyRepos: [],
      }),
    ).toEqual([
      "the record says a finding was fixed, but the step made no new commit",
    ]);
    const allGaveUp: FixOutcome[] = [{ ...gaveUp, finding: 1 }, gaveUp];
    expect(
      fixRecordProblems({
        fixes,
        outcomes: allGaveUp,
        hasNewCommit: true,
        dirtyRepos: [],
      }),
    ).toEqual([
      "every Fix was given up, so its change is reverted, but the step made a new commit",
    ]);
  });

  it("names each repo the step left uncommitted changes in", () => {
    expect(
      fixRecordProblems({
        fixes,
        outcomes: [fixed, gaveUp],
        hasNewCommit: true,
        dirtyRepos: ["byro-repo"],
      }),
    ).toEqual([
      "byro-repo: the step left uncommitted changes, such as a give-up it didn't revert",
    ]);
  });
});

describe("giveUpRecordOf", () => {
  it("turns a spec-axis give-up into a Halt scoped to the downstream tickets", () => {
    expect(
      giveUpRecordOf({
        record: fixOf(2, "spec"),
        gaveUp,
        downstream: ["byro-repo#7"],
      }),
    ).toMatchObject({
      verdict: "halt",
      reason: "judgement-call",
      haltScope: ["byro-repo#7"],
      recommendation:
        "The fixer gave up (judgement-call): Either name reads fine; the developer should pick.",
    });
  });

  it("scopes a spec-axis give-up's Halt to the whole spec when no ticket is downstream", () => {
    expect(
      giveUpRecordOf({ record: fixOf(2, "spec"), gaveUp, downstream: [] }),
    ).toMatchObject({ verdict: "halt", haltScope: "spec" });
  });

  it("turns a standards-axis give-up into a Defer `decision`", () => {
    expect(
      giveUpRecordOf({
        record: fixOf(2, "standards"),
        gaveUp,
        downstream: ["byro-repo#7"],
      }),
    ).toMatchObject({
      verdict: "defer",
      reason: "decision",
      recommendation:
        "The fixer gave up (judgement-call): Either name reads fine; the developer should pick.",
    });
  });
});
