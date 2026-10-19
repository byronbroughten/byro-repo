// The fix step: the prompt that hands a batch of Fix findings to a fixer, the fix record it returns, and its checker.
// findingTriage.ts gives the verdicts; SpecRun.ts picks the fixer, the resumed implementer or the triage agent,
// and turns a give-up into a Halt or a Defer with giveUpRecordOf().

import type { TriageRecord } from "./findingTriage.ts";
import { stepReadLine } from "./IssueReader.ts";
import type { IssueRef } from "./IssueWorkspaces.ts";
import { codeListOf } from "./promptText.ts";
import { arraySchema, objectSchema, stringSchema } from "./recordSchema.ts";

const giveUpReasons = ["judgement-call", "checks-red"] as const;

export type GiveUpReason = (typeof giveUpReasons)[number];

export type FixOutcome = FixedOutcome | GaveUpOutcome;

interface FixedOutcome {
  finding: number;
  status: "fixed";
}

export interface GaveUpOutcome {
  finding: number;
  status: "gave-up";
  reason: GiveUpReason;
  // Why, for the developer, who gets the finding back as a Halt or a Defer.
  note: string;
}

export interface FixPromptInput {
  issue: IssueRef;
  title: string;
  branch: string;
  branchedRepos: string[];
  // The Fix verdicts, each with its quote and rule.
  fixes: TriageRecord[];
}

export function fixPrompt({
  issue,
  title,
  branch,
  branchedRepos,
  fixes,
}: FixPromptInput): string {
  return `You are the fix step of an unattended run. Nobody is watching this session: never ask a question or wait for an answer.

Finding triage of the review of ${issue.repo}#${issue.number}, "${title}", gave the findings below the verdict Fix. Fix each one. Your working directory is the ticket's issue workspace root; these repos are on the ticket's branch, \`${branch}\`: ${branchedRepos.join(", ")}. Change only those repos; a fix that needs any other is a give-up. ${stepReadLine}

## How you work

- Read and search with the Read and Grep tools. Give Bash one command per call, run from the workspace root: no \`cd\`, no \`;\` or \`&&\` chains, no variables.
- Once the fixes are in, commit, then run \`npm run check\`. When it fails on a fix, fix it in a further commit and run it again. When it fails only on something your fixes didn't cause, return your outcomes anyway; the runner's checks step stops on it.
- A smell's \`rule\` carries its "→ how to fix" line. When two fixes are equally good, pick one and say which in the commit message; a tie is never a give-up.
- Give up on a finding with \`judgement-call\` only when the fix would reverse a spec decision, a User Story or an Implementation Decision, or with \`checks-red\` when its fix leaves the checks red and you can't turn them green. Revert that finding's change, in a further commit when it's already committed, and never turn a Fix into anything else.

## When you're done

- Commit in each repo you changed, on the ticket's branch: new commits, separate from the implement commit. Never amend, push, merge, rebase or reset, never comment on or close an issue, and never run the wrap-up. Commit nothing when you gave every finding up.
- Return \`outcomes\`, exactly one per finding: \`finding\` (its number below) and \`status\`, \`fixed\` or \`gave-up\`; a give-up also has \`reason\` (${codeListOf(giveUpReasons)}) and \`note\`, why, for the developer.

## Findings

${fixes.map(fixText).join("\n\n")}`;
}

function fixText({ finding, where, claim, quote, rule }: TriageRecord): string {
  return [
    `Finding ${finding}: ${claim}`,
    `Where: ${where}`,
    `Quote: ${quote ?? ""}`,
    `Rule: ${rule ?? ""}`,
  ].join("\n");
}

const outcomeSchema = {
  oneOf: [
    objectSchema({
      finding: { type: "integer", minimum: 1 },
      status: { const: "fixed" },
    }),
    objectSchema({
      finding: { type: "integer", minimum: 1 },
      status: { const: "gave-up" },
      reason: { enum: giveUpReasons },
      note: stringSchema,
    }),
  ],
};

export const fixOutputSchema = objectSchema({
  outcomes: arraySchema(outcomeSchema),
});

export function fixOutcomesOf(output: unknown): FixOutcome[] {
  return (output as { outcomes: FixOutcome[] }).outcomes;
}

export interface FixRecordCheck {
  fixes: TriageRecord[];
  outcomes: FixOutcome[];
  hasNewCommit: boolean;
  // The repos the step left uncommitted changes in.
  dirtyRepos: string[];
}

// What the schema can't see: one outcome per Fix, and whether what git shows matches what was fixed.
export function fixRecordProblems({
  fixes,
  outcomes,
  hasNewCommit,
  dirtyRepos,
}: FixRecordCheck): string[] {
  const batch = fixes.map(({ finding }) => finding);
  const countProblems = batch.flatMap((finding) => {
    const count = outcomes.filter((o) => o.finding === finding).length;
    if (count === 1) return [];
    return [
      `finding ${finding}: each Fix gets exactly one outcome, but it got ${count}`,
    ];
  });
  const unknownProblems = outcomes
    .filter(({ finding }) => !batch.includes(finding))
    .map(
      ({ finding }) => `finding ${finding}: the batch has no Fix ${finding}`,
    );
  return [
    ...countProblems,
    ...unknownProblems,
    ...commitProblems(outcomes, hasNewCommit),
    ...dirtyRepos.map(
      (repo) =>
        `${repo}: the step left uncommitted changes, such as a give-up it didn't revert`,
    ),
  ];
}

function commitProblems(
  outcomes: FixOutcome[],
  hasNewCommit: boolean,
): string[] {
  const hasFixed = outcomes.some(({ status }) => status === "fixed");
  if (hasFixed && !hasNewCommit) {
    return [
      "the record says a finding was fixed, but the step made no new commit",
    ];
  }
  if (!hasFixed && hasNewCommit) {
    return [
      "every Fix was given up, so its change is reverted, but the step made a new commit",
    ];
  }
  return [];
}

export interface GiveUp {
  record: TriageRecord;
  gaveUp: GaveUpOutcome;
  // The later tickets this one blocks, each `<repo>#<n>`.
  downstream: string[];
}

// A fixer never turns Fix into Dismiss: a give-up goes back to the developer, as a Halt on the spec axis, else a Defer.
export function giveUpRecordOf({
  record,
  gaveUp: { reason, note },
  downstream,
}: GiveUp): TriageRecord {
  const recommendation = `The fixer gave up (${reason}): ${note}`;
  if (record.axis === "spec") {
    // An empty scope would block nothing; with no downstream ticket the Halt holds the spec.
    const haltScope = downstream.length > 0 ? downstream : "spec";
    return { ...record, verdict: "halt", reason, haltScope, recommendation };
  }
  return { ...record, verdict: "defer", reason: "decision", recommendation };
}
