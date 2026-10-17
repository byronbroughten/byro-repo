import { Ajv } from "ajv";
import { describe, expect, it } from "vitest";

import {
  haltScopeOf,
  triageOutputSchema,
  triagePrompt,
  type TriageRecord,
  triageRecordProblems,
  triageRecordsOf,
} from "./findingTriage.ts";

// The same Ajv setup StepStream validates a step's structured output with.
const validateOutput = new Ajv({ allErrors: true, strict: false }).compile(
  triageOutputSchema,
);

const fix: TriageRecord = {
  finding: 1,
  axis: "standards",
  where: "runner/src/SpecRun.ts:88",
  claim: "A multi-line why comment above the retry loop.",
  quote: "runner/src/SpecRun.ts:88 `// Retry once, because...`",
  rule: "config/docs/code-style.md: A comment is one line.",
  verdict: "fix",
  evidence: "Lines 88-90 are one comment.",
};

const defer: TriageRecord = {
  finding: 1,
  axis: "standards",
  where: "runner/src/LandingLock.ts:40",
  claim: "The lock file name is built in two places.",
  verdict: "defer",
  reason: "ticket",
  evidence: "Both copies predate this branch.",
  recommendation: "File a ticket to name the lock file once.",
  draftIssueTitle: "Name the landing lock file in one place",
};

const halt: TriageRecord = {
  finding: 1,
  axis: "spec",
  where: "runner/src/SpecRun.ts:120",
  claim: "The ticket asks for a retry the spec forbids.",
  verdict: "halt",
  evidence: "The ticket and #213 disagree on retries.",
  recommendation: "Follow #213 and drop the retry.",
};

const dismiss: TriageRecord = {
  finding: 1,
  axis: "spec",
  where: "runner/src/SpecRun.ts:30",
  claim: "Wrap-up isn't wired in.",
  verdict: "dismiss",
  reason: "covered-later",
  coveredBy: "byro-repo#230",
  evidence: "#230 wires wrap-up into the run.",
};

describe("triageRecordProblems", () => {
  it("accepts a Fix with a quoted file:line and its rule", () => {
    expect(triageRecordProblems(1, [fix])).toEqual([]);
  });

  it("refuses a Fix whose quote names no file:line", () => {
    expect(
      triageRecordProblems(1, [{ ...fix, quote: "`// Retry once`" }]),
    ).toEqual([
      "finding 1: a Fix needs `quote`, the quoted code with its file:line",
    ]);
  });

  it("refuses a Fix with no rule", () => {
    expect(triageRecordProblems(1, [{ ...fix, rule: " " }])).toEqual([
      "finding 1: a Fix needs `rule`, the documented rule or spec line it breaks",
    ]);
  });

  it("refuses a Defer or a Halt with no recommendation", () => {
    const { recommendation: _deferred, ...bareDefer } = defer;
    const { recommendation: _halted, ...bareHalt } = { ...halt, finding: 2 };
    expect(triageRecordProblems(2, [bareDefer, bareHalt])).toEqual([
      "finding 1: a Defer needs `recommendation`",
      "finding 2: a Halt needs `recommendation`",
    ]);
  });

  it("refuses a Defer ticket with no drafted issue title", () => {
    const { draftIssueTitle: _title, ...untitled } = defer;
    expect(triageRecordProblems(1, [untitled])).toEqual([
      "finding 1: a Defer `ticket` needs `draftIssueTitle`",
    ]);
  });

  it("accepts a Defer decision with no drafted issue title", () => {
    const { draftIssueTitle: _title, ...decision } = defer;
    expect(
      triageRecordProblems(1, [{ ...decision, reason: "decision" }]),
    ).toEqual([]);
  });

  it("refuses a Defer whose reason is neither decision nor ticket", () => {
    expect(triageRecordProblems(1, [{ ...defer, reason: "later" }])).toEqual([
      "finding 1: a Defer needs reason `decision` or `ticket`, but has `later`",
    ]);
  });

  it("refuses a Dismiss without one of the four reasons", () => {
    const { reason: _reason, ...reasonless } = dismiss;
    expect(
      triageRecordProblems(2, [
        reasonless,
        { ...dismiss, finding: 2, reason: "duplicate" },
      ]),
    ).toEqual([
      "finding 1: a Dismiss needs reason `false-positive`, `covered-later`, `won't-fix` or `tooling-enforced`, but has none",
      "finding 2: a Dismiss needs reason `false-positive`, `covered-later`, `won't-fix` or `tooling-enforced`, but has `duplicate`",
    ]);
  });

  it("refuses a covered-later Dismiss that names no later ticket", () => {
    const { coveredBy: _ticket, ...uncovered } = dismiss;
    expect(triageRecordProblems(1, [uncovered])).toEqual([
      "finding 1: a `covered-later` Dismiss needs `coveredBy`, the later ticket",
    ]);
  });

  it("accepts a covered-later Dismiss naming its later ticket", () => {
    expect(triageRecordProblems(1, [dismiss])).toEqual([]);
  });

  it("refuses a finding given zero verdicts or two", () => {
    expect(
      triageRecordProblems(3, [
        fix,
        { ...halt, finding: 3 },
        { ...dismiss, finding: 3 },
      ]),
    ).toEqual([
      "finding 2: each finding gets exactly one verdict, but it got 0",
      "finding 3: each finding gets exactly one verdict, but it got 2",
    ]);
  });

  it("refuses a record for a finding the review doesn't have", () => {
    expect(triageRecordProblems(1, [fix, { ...halt, finding: 4 }])).toEqual([
      "finding 4: the review has no finding 4; findings run 1 to 1",
    ]);
  });
});

describe("haltScopeOf", () => {
  it("reads a Halt with no scope as scope spec", () => {
    expect(haltScopeOf(halt)).toBe("spec");
  });

  it("keeps the later tickets a Halt names", () => {
    expect(haltScopeOf({ ...halt, haltScope: ["byro-repo#231"] })).toEqual([
      "byro-repo#231",
    ]);
  });
});

describe("triageOutputSchema", () => {
  it("accepts one record per verdict and reads them back", () => {
    const output = { records: [fix, defer, halt, dismiss] };
    expect(validateOutput(output)).toBe(true);
    expect(triageRecordsOf(output)).toEqual([fix, defer, halt, dismiss]);
  });

  it("refuses a verdict outside the four", () => {
    expect(validateOutput({ records: [{ ...fix, verdict: "ignore" }] })).toBe(
      false,
    );
  });

  it("refuses a Halt scope naming no ticket", () => {
    expect(validateOutput({ records: [{ ...halt, haltScope: [] }] })).toBe(
      false,
    );
  });

  it("accepts a Halt scoped to the spec", () => {
    expect(validateOutput({ records: [{ ...halt, haltScope: "spec" }] })).toBe(
      true,
    );
  });
});

describe("triagePrompt", () => {
  const prompt = triagePrompt({
    issue: { repo: "byro-repo", number: 220 },
    title: "Finding-triage record, checker and prompt",
    branch: "issue-220-finding-triage-record-checker-and-prompt",
    branchedRepos: ["byro-repo"],
    findings: [
      "SpecRun.ts:88 has a multi-line comment.",
      "Wrap-up isn't wired in.",
    ],
  });

  it("numbers each finding for its record", () => {
    expect(prompt).toContain(
      "1. SpecRun.ts:88 has a multi-line comment.\n2. Wrap-up isn't wired in.",
    );
  });

  it("asks for one record per finding and forbids edits", () => {
    expect(prompt).toContain("exactly one record per finding");
    expect(prompt).toContain("Never edit code");
  });

  it("states every verdict rule", () => {
    [
      "`false-positive`, `covered-later`, `won't-fix` or `tooling-enforced`",
      "`coveredBy`",
      "a `code-style.md` line clearly backs it",
      "Doc drift the diff caused is Fix",
      "unverifiable findings and unbacked smells",
      "`draftIssueTitle`",
      "`haltScope`",
      "omit `haltScope` to scope it to the whole spec",
      "The runner never files them",
    ].forEach((rule) => expect(prompt).toContain(rule));
  });

  it("names the issue reader for the spec read", () => {
    expect(prompt).toContain("npm run issue:read -- <repo> <n> --hide-others");
  });
});
