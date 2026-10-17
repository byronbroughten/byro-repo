// Finding triage: the prompt that gives each review finding one verdict, the triage record it returns,
// and the checker that refuses a record naming the verdict rule it broke.
// reviewStep.ts supplies the findings; StepStream.ts checks the output against triageOutputSchema first.

import { stepReadLine } from "./IssueReader.ts";
import type { IssueRef } from "./IssueWorkspaces.ts";

const verdicts = ["dismiss", "fix", "defer", "halt"] as const;
const axes = ["standards", "spec"] as const;
const dismissReasons = [
  "false-positive",
  "covered-later",
  "won't-fix",
  "tooling-enforced",
] as const;
const deferReasons = ["decision", "ticket"] as const;

export type Verdict = (typeof verdicts)[number];
export type DismissReason = (typeof dismissReasons)[number];
export type DeferReason = (typeof deferReasons)[number];

// Named later tickets, each `<repo>#<n>`, plus their downstream; or the whole spec.
export type HaltScope = "spec" | string[];

// What the schema guarantees; triageRecordProblems() checks which fields each verdict needs.
export interface TriageRecord {
  // The finding's number in the review's list, from 1.
  finding: number;
  axis: (typeof axes)[number];
  where: string;
  claim: string;
  quote?: string;
  rule?: string;
  verdict: Verdict;
  reason?: string;
  evidence: string;
  coveredBy?: string;
  haltScope?: HaltScope;
  recommendation?: string;
  draftIssueTitle?: string;
}

export interface TriagePromptInput {
  issue: IssueRef;
  title: string;
  branch: string;
  branchedRepos: string[];
  // As the review record lists them; the prompt numbers them from 1.
  findings: string[];
}

export function triagePrompt({
  issue,
  title,
  branch,
  branchedRepos,
  findings,
}: TriagePromptInput): string {
  const numbered = findings.map((finding, index) => `${index + 1}. ${finding}`);
  return `You are the finding-triage step of an unattended run. Nobody is watching this session: never ask a question or wait for an answer.

The review of ${issue.repo}#${issue.number}, "${title}", reported the findings below. Give each one exactly one verdict. Your working directory is the ticket's issue workspace root; these repos are on the ticket's branch, \`${branch}\`: ${branchedRepos.join(", ")}. Verify each finding against the code, the ticket and its spec before you judge it. ${stepReadLine}

Never edit code, and change nothing else: no edits, commits, comments, issues or fixes. The runner acts on your verdicts.

## Verdicts

- **Dismiss**: no action. \`reason\` is ${orList(dismissReasons)}. A \`covered-later\` Dismiss names the later ticket that covers it in \`coveredBy\`, as \`<repo>#<n>\`.
- **Fix**: fixed now, in a separate commit. It needs \`quote\`, the quoted code with its file:line, and \`rule\`, the documented rule or spec line it breaks. A smell is Fix only when a \`code-style.md\` line clearly backs it. Doc drift the diff caused is Fix.
- **Defer**: left for the developer. \`reason\` is \`decision\` for a judgement only they can make, including unverifiable findings and unbacked smells, or \`ticket\` for a problem that predates this branch, with a drafted issue title in \`draftIssueTitle\`. The runner never files them.
- **Halt**: blocks tickets until the developer answers. \`haltScope\` names the later tickets it blocks, each \`<repo>#<n>\`, with their downstream; when unsure, omit \`haltScope\` to scope it to the whole spec.
- Defer and Halt each need \`recommendation\`, what you recommend the developer do.

## The record

Return \`records\`, exactly one record per finding: \`finding\` (its number below), \`axis\` (\`standards\` or \`spec\`), \`where\` (its file:line or area), \`claim\` (what the finding says, in a line), \`verdict\` (\`dismiss\`, \`fix\`, \`defer\` or \`halt\`), \`evidence\` (what you checked and found), and the fields its verdict needs above.

## Findings

${numbered.join("\n")}`;
}

const stringSchema = { type: "string" };

const triageRecordSchema = {
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
  },
  required: ["finding", "axis", "where", "claim", "verdict", "evidence"],
  additionalProperties: false,
};

// The verdict rules stay out of the schema so triageRecordProblems() can name the one a record broke.
export const triageOutputSchema = {
  type: "object",
  properties: { records: { type: "array", items: triageRecordSchema } },
  required: ["records"],
  additionalProperties: false,
};

export function triageRecordsOf(output: unknown): TriageRecord[] {
  return (output as { records: TriageRecord[] }).records;
}

export function triageRecordProblems(
  findingCount: number,
  records: TriageRecord[],
): string[] {
  return [
    ...verdictCountProblems(findingCount, records),
    ...records.flatMap((record) =>
      recordProblems(record).map(
        (problem) => `finding ${record.finding}: ${problem}`,
      ),
    ),
  ];
}

function verdictCountProblems(
  findingCount: number,
  records: TriageRecord[],
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
        `finding ${finding}: each finding gets exactly one verdict, but it got ${count}`,
      ];
    }),
    ...unknown.map(
      (finding) =>
        `finding ${finding}: the review has no finding ${finding}; findings run 1 to ${findingCount}`,
    ),
  ];
}

function recordProblems(record: TriageRecord): string[] {
  return verdictRules[record.verdict](record);
}

const verdictRules: Record<Verdict, (record: TriageRecord) => string[]> = {
  dismiss: ({ reason, coveredBy }) => {
    if (!isOneOf(dismissReasons, reason)) {
      return [
        `a Dismiss needs reason ${orList(dismissReasons)}, but has ${reasonText(reason)}`,
      ];
    }
    if (reason === "covered-later" && isBlank(coveredBy)) {
      return ["a `covered-later` Dismiss needs `coveredBy`, the later ticket"];
    }
    return [];
  },
  fix: ({ quote, rule }) => [
    ...(hasFileLine(quote)
      ? []
      : ["a Fix needs `quote`, the quoted code with its file:line"]),
    ...(isBlank(rule)
      ? ["a Fix needs `rule`, the documented rule or spec line it breaks"]
      : []),
  ],
  defer: ({ reason, recommendation, draftIssueTitle }) => [
    ...(isOneOf(deferReasons, reason)
      ? []
      : [
          `a Defer needs reason ${orList(deferReasons)}, but has ${reasonText(reason)}`,
        ]),
    ...recommendationProblems("Defer", recommendation),
    ...(reason === "ticket" && isBlank(draftIssueTitle)
      ? ["a Defer `ticket` needs `draftIssueTitle`"]
      : []),
  ],
  halt: ({ recommendation }) => recommendationProblems("Halt", recommendation),
};

function recommendationProblems(
  verdict: "Defer" | "Halt",
  recommendation: string | undefined,
): string[] {
  if (!isBlank(recommendation)) return [];
  return [`a ${verdict} needs \`recommendation\``];
}

// A Halt with no scope blocks the whole spec: the safe default when the triage agent is unsure.
export function haltScopeOf(record: TriageRecord): HaltScope {
  return record.haltScope ?? "spec";
}

function hasFileLine(quote: string | undefined): boolean {
  return /\S+:\d+/.test(quote ?? "");
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

function orList(words: readonly string[]): string {
  const quoted = words.map((word) => `\`${word}\``);
  return `${quoted.slice(0, -1).join(", ")} or ${quoted.at(-1)}`;
}

function reasonText(reason: string | undefined): string {
  if (reason === undefined) return "none";
  return `\`${reason}\``;
}
