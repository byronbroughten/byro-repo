import { Ajv } from "ajv";
import { describe, expect, it } from "vitest";

import {
  haltScopeOf,
  resolveCommitProblems,
  resolveOutputSchema,
  resolvePrompt,
  type ResolveRecord,
  resolveRecordProblems,
  resolveRecordsOf,
  whatReviewCaughtOf,
} from "./resolveStep.ts";

// The same Ajv setup StepStream validates a step's structured output with.
const validateOutput = new Ajv({ allErrors: true, strict: false }).compile(
  resolveOutputSchema,
);

const fix: ResolveRecord = {
  finding: 1,
  axis: "standards",
  where: "runner/src/SpecRun.ts:88",
  claim: "A multi-line why comment above the retry loop.",
  quote: "runner/src/SpecRun.ts:88 `// Retry once, because...`",
  rule: "config/docs/code-style.md: A comment is one line.",
  verdict: "fix",
  evidence: "Lines 88-90 are one comment.",
};

const propose: ResolveRecord = {
  finding: 1,
  axis: "standards",
  where: "runner/src/LandingLock.ts:40",
  claim: "The lock file name is built in two places.",
  verdict: "propose",
  reason: "ticket",
  evidence: "Both copies predate this branch.",
  recommendation: "File a ticket to name the lock file once.",
  draftIssueTitle: "Name the landing lock file in one place",
};

const halt: ResolveRecord = {
  finding: 1,
  axis: "spec",
  where: "runner/src/SpecRun.ts:120",
  claim: "The ticket asks for a retry the spec forbids.",
  verdict: "halt",
  evidence: "The ticket and #213 disagree on retries.",
  recommendation: "Follow #213 and drop the retry.",
};

const dismiss: ResolveRecord = {
  finding: 1,
  axis: "spec",
  where: "runner/src/SpecRun.ts:30",
  claim: "Wrap-up isn't wired in.",
  verdict: "dismiss",
  reason: "covered-later",
  coveredBy: "byro-repo#230",
  evidence: "#230 wires wrap-up into the run.",
};

const kept: ResolveRecord = {
  finding: 1,
  axis: "standards",
  where: "runner/src/StepStream.ts:52",
  claim: "Possible Middle Man: streamOf() only delegates.",
  quote:
    "runner/src/StepStream.ts:51 `// A seam for the fake stream in tests, not a pass-through.`",
  verdict: "dismiss",
  reason: "kept",
  evidence: "The comment above the site still holds: SpecRun.test.ts fakes it.",
};

describe("resolveRecordProblems", () => {
  it("accepts a Fix with a quoted file:line and its rule", () => {
    expect(resolveRecordProblems(1, [fix])).toEqual([]);
  });

  it("refuses a Fix whose quote names no file:line", () => {
    expect(
      resolveRecordProblems(1, [{ ...fix, quote: "`// Retry once`" }]),
    ).toEqual([
      "finding 1: a Fix needs `quote`, the quoted code with its file:line",
    ]);
  });

  it("refuses a Fix whose quote has a line number but no file", () => {
    expect(
      resolveRecordProblems(1, [{ ...fix, quote: "retries at 12:30" }]),
    ).toEqual([
      "finding 1: a Fix needs `quote`, the quoted code with its file:line",
    ]);
  });

  it("refuses a Fix with no rule", () => {
    expect(resolveRecordProblems(1, [{ ...fix, rule: " " }])).toEqual([
      "finding 1: a Fix needs `rule`, the documented rule or spec line it breaks",
    ]);
  });

  it("refuses a Propose or a Halt with no recommendation", () => {
    const { recommendation: _recommendation, ...bareProposal } = propose;
    const { recommendation: _halted, ...bareHalt } = { ...halt, finding: 2 };
    expect(resolveRecordProblems(2, [bareProposal, bareHalt])).toEqual([
      "finding 1: a Propose needs `recommendation`",
      "finding 2: a Halt needs `recommendation`",
    ]);
  });

  it("refuses a Propose ticket with no drafted issue title", () => {
    const { draftIssueTitle: _title, ...untitled } = propose;
    expect(resolveRecordProblems(1, [untitled])).toEqual([
      "finding 1: a Propose `ticket` needs `draftIssueTitle`",
    ]);
  });

  it("accepts a Propose decision with no drafted issue title", () => {
    const { draftIssueTitle: _title, ...decision } = propose;
    expect(
      resolveRecordProblems(1, [{ ...decision, reason: "decision" }]),
    ).toEqual([]);
  });

  it("accepts a Propose decision with a drafted keep reason", () => {
    const { draftIssueTitle: _title, ...decision } = propose;
    expect(
      resolveRecordProblems(1, [
        {
          ...decision,
          reason: "decision",
          draftKeepReason: "Two call sites read better than one helper.",
        },
      ]),
    ).toEqual([]);
  });

  it("refuses a blank drafted keep reason", () => {
    expect(
      resolveRecordProblems(1, [
        { ...propose, reason: "decision", draftKeepReason: " " },
      ]),
    ).toEqual([
      "finding 1: a Propose `decision`'s `draftKeepReason` can't be blank",
    ]);
  });

  it("refuses a drafted keep reason on any verdict or reason but Propose decision", () => {
    const draftKeepReason = "Two call sites read better than one helper.";
    expect(
      resolveRecordProblems(4, [
        { ...propose, draftKeepReason },
        { ...fix, finding: 2, draftKeepReason },
        { ...kept, finding: 3, draftKeepReason },
        { ...halt, finding: 4, draftKeepReason },
      ]),
    ).toEqual([
      "finding 1: only a Propose `decision` has `draftKeepReason`",
      "finding 2: only a Propose `decision` has `draftKeepReason`",
      "finding 3: only a Propose `decision` has `draftKeepReason`",
      "finding 4: only a Propose `decision` has `draftKeepReason`",
    ]);
  });

  it("refuses a Propose whose reason is neither decision nor ticket", () => {
    expect(resolveRecordProblems(1, [{ ...propose, reason: "later" }])).toEqual(
      [
        "finding 1: a Propose needs reason `decision` or `ticket`, but has `later`",
      ],
    );
  });

  it("refuses a Dismiss without one of the five reasons", () => {
    const { reason: _reason, ...reasonless } = dismiss;
    expect(
      resolveRecordProblems(2, [
        reasonless,
        { ...dismiss, finding: 2, reason: "duplicate" },
      ]),
    ).toEqual([
      "finding 1: a Dismiss needs reason `false-positive`, `covered-later`, `kept`, `tooling-enforced` or `serves-spec`, but has none",
      "finding 2: a Dismiss needs reason `false-positive`, `covered-later`, `kept`, `tooling-enforced` or `serves-spec`, but has `duplicate`",
    ]);
  });

  it("refuses a covered-later Dismiss that names no later ticket", () => {
    const { coveredBy: _ticket, ...uncovered } = dismiss;
    expect(resolveRecordProblems(1, [uncovered])).toEqual([
      "finding 1: a `covered-later` Dismiss needs `coveredBy`, the later ticket as `<repo>#<n>`",
    ]);
  });

  it("refuses a covered-later Dismiss whose ticket has no repo", () => {
    expect(
      resolveRecordProblems(1, [{ ...dismiss, coveredBy: "#230" }]),
    ).toEqual([
      "finding 1: a `covered-later` Dismiss needs `coveredBy`, the later ticket as `<repo>#<n>`",
    ]);
  });

  it("accepts a covered-later Dismiss naming its later ticket", () => {
    expect(resolveRecordProblems(1, [dismiss])).toEqual([]);
  });

  it("accepts a kept Dismiss quoting its reason with a file:line", () => {
    expect(resolveRecordProblems(1, [kept])).toEqual([]);
  });

  it("refuses a kept Dismiss with no quote, or a quote with no file", () => {
    const { quote: _quote, ...unquoted } = kept;
    expect(
      resolveRecordProblems(2, [
        unquoted,
        { ...kept, finding: 2, quote: "a seam, kept at line 51" },
      ]),
    ).toEqual([
      "finding 1: a `kept` Dismiss needs `quote`, its reason quoted with its file:line",
      "finding 2: a `kept` Dismiss needs `quote`, its reason quoted with its file:line",
    ]);
  });

  it("refuses a won't-fix Dismiss as outside the reasons", () => {
    expect(
      resolveRecordProblems(1, [{ ...dismiss, reason: "won't-fix" }]),
    ).toEqual([
      "finding 1: a Dismiss needs reason `false-positive`, `covered-later`, `kept`, `tooling-enforced` or `serves-spec`, but has `won't-fix`",
    ]);
  });

  it("accepts a serves-spec Dismiss with its evidence", () => {
    expect(
      resolveRecordProblems(1, [{ ...dismiss, reason: "serves-spec" }]),
    ).toEqual([]);
  });

  it("refuses a suggested Halt resolved as a Fix or a Dismiss", () => {
    expect(
      resolveRecordProblems(2, [
        { ...fix, suggestedVerdict: "halt" },
        { ...dismiss, finding: 2, suggestedVerdict: "halt" },
      ]),
    ).toEqual([
      "finding 1: a suggested Halt resolves only as a Halt or a Propose `decision`",
      "finding 2: a suggested Halt resolves only as a Halt or a Propose `decision`",
    ]);
  });

  it("accepts a suggested Halt resolved as a Halt or a Propose decision", () => {
    expect(
      resolveRecordProblems(2, [
        { ...halt, suggestedVerdict: "halt" },
        {
          ...propose,
          finding: 2,
          reason: "decision",
          suggestedVerdict: "halt",
        },
      ]),
    ).toEqual([]);
  });

  it("refuses a finding given zero verdicts or two", () => {
    expect(
      resolveRecordProblems(3, [
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
    expect(resolveRecordProblems(1, [fix, { ...halt, finding: 4 }])).toEqual([
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

describe("whatReviewCaughtOf", () => {
  it("names the kept findings by verdict, leaving out Dismisses", () => {
    const second = {
      ...fix,
      finding: 2,
      claim: "A stale doc link.",
      where: "README.md:4",
    };

    expect(
      whatReviewCaughtOf([dismiss, fix, halt, second, propose, kept]),
    ).toBe(
      "Fixed: A multi-line why comment above the retry loop. (runner/src/SpecRun.ts:88); A stale doc link. (README.md:4). Proposed: The lock file name is built in two places. (runner/src/LandingLock.ts:40). Halted: The ticket asks for a retry the spec forbids. (runner/src/SpecRun.ts:120).",
    );
  });

  it("is undefined when every finding was dismissed", () => {
    expect(whatReviewCaughtOf([dismiss, kept])).toBeUndefined();
  });
});

describe("resolveOutputSchema", () => {
  it("accepts one record per verdict and reads them back", () => {
    const output = { records: [fix, propose, halt, dismiss, kept] };
    expect(validateOutput(output)).toBe(true);
    expect(resolveRecordsOf(output)).toEqual([
      fix,
      propose,
      halt,
      dismiss,
      kept,
    ]);
  });

  it("refuses a verdict outside the four", () => {
    expect(validateOutput({ records: [{ ...fix, verdict: "ignore" }] })).toBe(
      false,
    );
  });

  it("refuses Defer, Propose's old name, in a new record", () => {
    expect(
      validateOutput({ records: [{ ...propose, verdict: "defer" }] }),
    ).toBe(false);
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

describe("resolvePrompt", () => {
  const prompt = resolvePrompt({
    issue: { repo: "byro-repo", number: 220 },
    title: "Finding-triage record, checker and prompt",
    branch: "issue-220-finding-triage-record-checker-and-prompt",
    branchedRepos: ["byro-repo"],
    findings: [
      {
        axis: "standards",
        where: "SpecRun.ts:88",
        claim: "It has a multi-line comment.",
        suggestedVerdict: "fix",
        reason: "Smells: Multi-line comment.",
      },
      "Wrap-up isn't wired in.",
    ],
  });

  it("numbers each finding for its record, a structured one with its axis and suggested verdict, a saved prose one as it was", () => {
    expect(prompt).toContain(
      "1. [standards] SpecRun.ts:88: It has a multi-line comment. Suggested verdict: fix, Smells: Multi-line comment.\n2. Wrap-up isn't wired in.",
    );
  });

  it("asks for one record per finding and a commit per Fix", () => {
    expect(prompt).toContain("exactly one record per finding");
    expect(prompt).toContain("Each Fix lands in its own commit");
  });

  it("halts on a spec-axis fix it can't land, and Proposes any other", () => {
    expect(prompt).toContain(
      "as a Propose `decision`, or for a `spec`-axis finding as a Halt scoped to the downstream tickets",
    );
  });

  it("names the verdict-rules doc instead of carrying its rules", () => {
    expect(prompt).toContain("`docs/agents/verdicts.md`");
    [
      "Doc drift",
      "the finding is wrong",
      "unverifiable findings",
      "would reverse a User Story",
    ].forEach((rule) => expect(prompt).not.toContain(rule));
  });

  it("lists the fields each verdict's record needs", () => {
    [
      "`serves-spec`",
      "`coveredBy`",
      "`draftKeepReason`",
      "`draftIssueTitle`",
      "`haltScope`",
    ].forEach((field) => expect(prompt).toContain(field));
  });

  it("names the issue reader for the spec read", () => {
    expect(prompt).toContain("npm run issue:read -- <repo> <n> --hide-others");
  });
});

describe("resolveCommitProblems", () => {
  const clean = { hasChangedTree: false, dirtyRepos: [] };

  it("accepts a Fix with a committed change", () => {
    expect(
      resolveCommitProblems({ ...clean, records: [fix], hasChangedTree: true }),
    ).toEqual([]);
  });

  it("refuses a Fix with no committed change", () => {
    expect(resolveCommitProblems({ ...clean, records: [fix] })).toEqual([
      "the records give a Fix, but the step committed no change",
    ]);
  });

  it("refuses a committed change with no Fix", () => {
    expect(
      resolveCommitProblems({
        ...clean,
        records: [propose],
        hasChangedTree: true,
      }),
    ).toEqual(["no record is a Fix, but the step committed a change"]);
  });

  it("accepts no Fix and no change, as a fix reverted into a Propose leaves", () => {
    expect(resolveCommitProblems({ ...clean, records: [propose] })).toEqual([]);
  });

  it("refuses each repo left with uncommitted changes", () => {
    expect(
      resolveCommitProblems({
        ...clean,
        records: [dismiss],
        dirtyRepos: ["x"],
      }),
    ).toEqual([
      "x: the step left uncommitted changes, such as a fix it didn't commit or revert",
    ]);
  });
});
