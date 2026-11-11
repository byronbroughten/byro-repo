// The resolve record every Workflow's resolve step returns, its schema, its numbered findings and retry prompt, and the
// checkers that refuse a record, or commits that disagree with it, naming the rule broken; resolveRulesOf builds a
// Workflow's resolve rules from them and its own prompt and record checks, resolve resuming implement.
// stepRecords.ts holds the record types; StepStream.ts checks the output against resolveOutputSchema first.

import { codeListOf } from "./promptText.ts";
import { schemaProblemsOf, stringSchema } from "./recordSchema.ts";
import {
  dismissReasons,
  type Finding,
  issueRefOf,
  proposeReasons,
  type ResolveRecord,
} from "./stepRecords.ts";
import { axes, type Verdict, verdicts } from "./verdicts.ts";
import type {
  ResolveCommits,
  ResolvePromptInput,
  ResolveRules,
} from "./Workflow.ts";

export interface ResolveRulesInput {
  promptOf(input: ResolvePromptInput): string;
  recordProblems(findingCount: number, records: ResolveRecord[]): string[];
}

export function resolveRulesOf({
  promptOf,
  recordProblems,
}: ResolveRulesInput): ResolveRules {
  return {
    promptOf,
    retryPromptOf: resolveRetryPrompt,
    outputSchema: resolveOutputSchema,
    outputProblems: resolveOutputProblems,
    recordsOf: resolveRecordsOf,
    withReviewerFields,
    recordProblems,
    commitProblems: resolveCommitProblems,
    numberedFindingsOf,
    resumes: {
      step: "implement",
      freshRetryPromptOf(input, problems) {
        return `${promptOf(input)}\n\n${resolveRetryPrompt(problems)}`;
      },
    },
  };
}

// Numbered from 1, as a resolve record's `finding` names them.
export function numberedFindingsOf(findings: Finding[]): string {
  return findings
    .map((finding, index) => `${index + 1}. ${findingLineOf(finding)}`)
    .join("\n");
}

function findingLineOf(finding: Finding): string {
  if (typeof finding === "string") return finding;
  const { axis, where, claim, suggestedVerdict, reason } = finding;
  return `[${axis}] ${where}: ${claim} Suggested verdict: ${suggestedVerdict}, ${reason}`;
}

// Sent with --resume to a resolver whose records or commits broke a rule; its one retry.
export function resolveRetryPrompt(problems: string[]): string {
  const rules = problems.map((problem) => `- ${problem}`).join("\n");
  return `Your records broke these rules:\n\n${rules}\n\nCorrect them, committing any fix they need, and return \`records\` again, every finding's.`;
}

export const resolveRecordSchema = {
  type: "object",
  properties: {
    finding: { type: "integer", minimum: 1 },
    axis: { enum: axes },
    where: stringSchema,
    claim: stringSchema,
    quote: stringSchema,
    rule: stringSchema,
    verdict: { enum: verdicts },
    reason: stringSchema,
    evidence: stringSchema,
    coveredBy: stringSchema,
    haltScope: {
      anyOf: [
        { const: "spec" },
        { type: "array", items: stringSchema, minItems: 1 },
      ],
    },
    recommendation: stringSchema,
    draftIssueTitle: stringSchema,
    draftKeepReason: stringSchema,
  },
  required: ["finding", "axis", "where", "claim", "verdict", "evidence"],
  additionalProperties: false,
};

// The verdict rules stay out of the schema so resolveRecordProblems() can name the one a record broke.
export const resolveOutputSchema = {
  type: "object",
  properties: { records: { type: "array", items: resolveRecordSchema } },
  required: ["records"],
  additionalProperties: false,
};

export function resolveRecordsOf(output: unknown): ResolveRecord[] {
  return (output as { records: ResolveRecord[] }).records;
}

// A step's output passed resolveOutputSchema already; a session's records file did not.
export function resolveOutputProblems(output: unknown): string[] {
  return schemaProblemsOf(resolveOutputSchema, output);
}

// A structured finding's axis and suggested verdict are its reviewer's, whatever the resolver wrote.
export function withReviewerFields(
  records: ResolveRecord[],
  findings: Finding[],
): ResolveRecord[] {
  return records.map((record) => {
    const finding = findings[record.finding - 1];
    if (finding === undefined || typeof finding === "string") return record;
    const { axis, suggestedVerdict } = finding;
    return { ...record, axis, suggestedVerdict };
  });
}

export function resolveRecordProblems(
  findingCount: number,
  records: ResolveRecord[],
): string[] {
  return [
    ...verdictCountProblems(findingCount, records),
    ...records.flatMap((record) =>
      [
        ...verdictRules[record.verdict](record),
        ...keepReasonRules(record),
        ...suggestedHaltRules(record),
      ].map((rule) => findingProblem(record.finding, rule)),
    ),
  ];
}

// What the records can't show alone: whether what git shows matches the Fix verdicts.
export function resolveCommitProblems({
  records,
  hasChangedTree,
  dirtyRepos,
}: ResolveCommits): string[] {
  const hasFix = records.some(({ verdict }) => verdict === "fix");
  return [
    ...brokenRules([
      [
        hasFix && !hasChangedTree,
        "the records give a Fix, but the step committed no change",
      ],
      [
        !hasFix && hasChangedTree,
        "no record is a Fix, but the step committed a change",
      ],
    ]),
    ...dirtyRepos.map(
      (repo) =>
        `${repo}: the step left uncommitted changes, such as a fix it didn't commit or revert`,
    ),
  ];
}

function verdictCountProblems(
  findingCount: number,
  records: ResolveRecord[],
): string[] {
  const counts = records.reduce((byFinding, { finding }) => {
    byFinding.set(finding, (byFinding.get(finding) ?? 0) + 1);
    return byFinding;
  }, new Map<number, number>());
  const findings = Array.from(
    { length: findingCount },
    (_, index) => index + 1,
  );
  const unknown = [...counts.keys()].filter(
    (finding) => !findings.includes(finding),
  );
  return [
    ...findings.flatMap((finding) => {
      const count = counts.get(finding) ?? 0;
      if (count === 1) return [];
      return [
        findingProblem(
          finding,
          `each finding gets exactly one verdict, but it got ${count}`,
        ),
      ];
    }),
    ...unknown.map((finding) =>
      findingProblem(
        finding,
        `the review has no finding ${finding}; findings run 1 to ${findingCount}`,
      ),
    ),
  ];
}

export function findingProblem(finding: number, rule: string): string {
  return `finding ${finding}: ${rule}`;
}

// Each verdict's rules, as [is broken, the rule] pairs; a record gets every rule it broke.
const verdictRules: Record<Verdict, (record: ResolveRecord) => string[]> = {
  dismiss: ({ reason, coveredBy, quote }) =>
    brokenRules([
      [
        !isOneOf(dismissReasons, reason),
        reasonRule("Dismiss", dismissReasons, reason),
      ],
      [
        reason === "covered-later" && issueRefOf(coveredBy) === undefined,
        "a `covered-later` Dismiss needs `coveredBy`, the later ticket as `<repo>#<n>`",
      ],
      [
        reason === "kept" && !hasFileLine(quote),
        "a `kept` Dismiss needs `quote`, its reason quoted with its file:line",
      ],
    ]),
  fix: ({ quote, rule }) =>
    brokenRules([
      [
        !hasFileLine(quote),
        "a Fix needs `quote`, the quoted code or text, with its file:line",
      ],
      [
        isBlank(rule),
        "a Fix needs `rule`, the documented rule or spec line it breaks",
      ],
    ]),
  propose: ({ reason, recommendation, draftIssueTitle }) =>
    brokenRules([
      [
        !isOneOf(proposeReasons, reason),
        reasonRule("Propose", proposeReasons, reason),
      ],
      [isBlank(recommendation), recommendationRule("Propose")],
      [
        reason === "ticket" && isBlank(draftIssueTitle),
        "a Propose `ticket` needs `draftIssueTitle`",
      ],
    ]),
  halt: ({ recommendation }) =>
    brokenRules([[isBlank(recommendation), recommendationRule("Halt")]]),
};

function keepReasonRules({
  verdict,
  reason,
  draftKeepReason,
}: ResolveRecord): string[] {
  const isDecision = verdict === "propose" && reason === "decision";
  return brokenRules([
    [
      draftKeepReason !== undefined && !isDecision,
      "only a Propose `decision` has `draftKeepReason`",
    ],
    [
      isDecision && draftKeepReason !== undefined && isBlank(draftKeepReason),
      "a Propose `decision`'s `draftKeepReason` can't be blank",
    ],
  ]);
}

function suggestedHaltRules({
  suggestedVerdict,
  verdict,
  reason,
}: ResolveRecord): string[] {
  const isDecision = verdict === "propose" && reason === "decision";
  return brokenRules([
    [
      suggestedVerdict === "halt" && verdict !== "halt" && !isDecision,
      "a suggested Halt resolves only as a Halt or a Propose `decision`",
    ],
  ]);
}

function brokenRules(rules: [isBroken: boolean, rule: string][]): string[] {
  return rules.flatMap(([isBroken, rule]) => (isBroken ? [rule] : []));
}

function reasonRule(
  verdict: "Dismiss" | "Propose",
  reasons: readonly string[],
  reason: string | undefined,
): string {
  const given = reason === undefined ? "none" : `\`${reason}\``;
  return `a ${verdict} needs reason ${codeListOf(reasons)}, but has ${given}`;
}

function recommendationRule(verdict: "Propose" | "Halt"): string {
  return `a ${verdict} needs \`recommendation\``;
}

// A token with a `/` or a `.`, then a line: `runner/src/SpecRun.ts:88`, `.gitignore:23`. A bare `foo:3` fails.
export function hasFileLine(quote: string | undefined): boolean {
  return /[\w./-]*[./][\w./-]*:\d+/.test(quote ?? "");
}

function isBlank(text: string | undefined): boolean {
  return (text ?? "").trim() === "";
}

function isOneOf<VV extends string>(
  values: readonly VV[],
  value: string | undefined,
): value is VV {
  return (values as readonly (string | undefined)[]).includes(value);
}
