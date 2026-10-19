// Finding triage: the prompt that gives each review finding one verdict, the triage record it returns,
// and the checker that refuses a record naming the verdict rule it broke.
// reviewStep.ts supplies the findings; StepStream.ts checks the output against triageOutputSchema first.

import { stepReadLine } from "./IssueReader.ts";
import type { IssueRef } from "./IssueWorkspaces.ts";
import { codeListOf } from "./promptText.ts";
import { stringSchema } from "./recordSchema.ts";

const verdicts = ["dismiss", "fix", "propose", "halt"] as const;
const axes = ["standards", "spec"] as const;
// Each Dismiss reason with its definition, as the prompt states it.
const dismissReasonDefinitions = {
  "false-positive":
    "the finding is wrong about the code, the ticket or the spec",
  "covered-later":
    "a later ticket covers it, named in `coveredBy` as `<repo>#<n>`",
  kept: "a smell whose site carries a one-line reason that is still true, quoted with its file:line in `quote`",
  "tooling-enforced": "lint, the typecheck or a test already catches it",
} as const;
const dismissReasons = Object.keys(
  dismissReasonDefinitions,
) as (keyof typeof dismissReasonDefinitions)[];
const proposeReasons = ["decision", "ticket"] as const;

export type Verdict = (typeof verdicts)[number];
export type DismissReason = (typeof dismissReasons)[number];
export type ProposeReason = (typeof proposeReasons)[number];

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
  draftKeepReason?: string;
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

- **Dismiss**: no action. \`reason\` is one of:
${dismissReasonLines()}.
- **Fix**: fixed now, in a separate commit. It needs \`quote\`, the quoted code with its file:line, and \`rule\`, the documented rule or spec line it breaks. A smell is Fix by default (\`config/docs/code-style.md#smells\`): unless it is \`kept\` or a Propose \`decision\`, \`rule\` names the smell and that section, with the smell's "→ how to fix" line from the finding. Doc drift the diff caused is Fix.
- **Propose**: left for the developer. \`reason\` is \`decision\` for a judgement only they can make, or \`ticket\` for a problem that predates this branch, with a drafted issue title in \`draftIssueTitle\`. The runner never files them. A \`decision\` covers unverifiable findings and two smell cases:
  - a smell you think is wanted but whose site carries no reason, with the drafted one-line reason in \`draftKeepReason\` and \`recommendation\` asking the developer to approve it, since every new keep needs their yes;
  - a smell whose fix would reverse a User Story or an Implementation Decision. A spec protects decisions, not wording: a fix that changes how a decision is met while the decision still holds is a Fix.
- **Halt**: blocks tickets until the developer answers. \`haltScope\` names the later tickets it blocks, each \`<repo>#<n>\`, with their downstream, or is \`spec\` for the whole spec; when unsure, omit \`haltScope\` to scope it to the whole spec.
- Propose and Halt each need \`recommendation\`, what you recommend the developer do.
- Only that wanted-smell case of Propose \`decision\` has \`draftKeepReason\`.

## The record

Return \`records\`, exactly one record per finding: \`finding\` (its number below), \`axis\` (\`standards\` or \`spec\`), \`where\` (its file:line or area), \`claim\` (what the finding says, in a line), \`verdict\` (\`dismiss\`, \`fix\`, \`propose\` or \`halt\`), \`evidence\` (what you checked and found), and the fields its verdict needs above.

## Findings

${numbered.join("\n")}`;
}

function dismissReasonLines(): string {
  return Object.entries(dismissReasonDefinitions)
    .map(([reason, definition]) => `  - \`${reason}\`: ${definition}`)
    .join(";\n");
}

// Sent with --resume to a triage agent whose records broke a verdict rule; its one retry.
export function triageRetryPrompt(problems: string[]): string {
  const rules = problems.map((problem) => `- ${problem}`).join("\n");
  return `Your records broke these rules:\n\n${rules}\n\nReturn \`records\` again, every finding's, with these corrected. Change nothing else.`;
}

export const triageRecordSchema = {
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

// A run state saved before #297 holds Propose under its old name, Defer.
export interface SavedTriageRecord extends Omit<TriageRecord, "verdict"> {
  verdict: Verdict | "defer";
}

export function savedTriageRecordOf({
  verdict,
  ...record
}: SavedTriageRecord): TriageRecord {
  return { ...record, verdict: verdict === "defer" ? "propose" : verdict };
}

export function triageRecordProblems(
  findingCount: number,
  records: TriageRecord[],
): string[] {
  return [
    ...verdictCountProblems(findingCount, records),
    ...records.flatMap((record) =>
      [...verdictRules[record.verdict](record), ...keepReasonRules(record)].map(
        (rule) => findingProblem(record.finding, rule),
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

function findingProblem(finding: number, rule: string): string {
  return `finding ${finding}: ${rule}`;
}

// Each verdict's rules, as [is broken, the rule] pairs; a record gets every rule it broke.
const verdictRules: Record<Verdict, (record: TriageRecord) => string[]> = {
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
        "a Fix needs `quote`, the quoted code with its file:line",
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
}: TriageRecord): string[] {
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

// A Halt with no scope blocks the whole spec: the safe default when the triage agent is unsure.
export function haltScopeOf(record: TriageRecord): HaltScope {
  return record.haltScope ?? "spec";
}

// A `<repo>#<n>` reference, as `coveredBy` names its ticket.
export function issueRefOf(text: string | undefined): IssueRef | undefined {
  const match = /^([\w.-]+)#(\d+)$/.exec(text?.trim() ?? "");
  if (match === null) return undefined;
  const [, repo = "", number = ""] = match;
  return { repo, number: Number(number) };
}

// A path with an extension, then a line: `runner/src/SpecRun.ts:88`.
function hasFileLine(quote: string | undefined): boolean {
  return /[\w./-]+\.\w+:\d+/.test(quote ?? "");
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
