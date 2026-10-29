// Resolve: the prompt that gives each review finding one verdict and fixes the Fix ones, the resolve record it returns,
// and the checkers that refuse a record, or commits that disagree with it, naming the rule broken.
// reviewStep.ts supplies the findings; StepStream.ts checks the output against resolveOutputSchema first.

import { stepReadLine } from "./IssueReader.ts";
import type { IssueRef } from "./IssueWorkspaces.ts";
import { codeListOf, stepWriteLine } from "./promptText.ts";
import { schemaProblemsOf, stringSchema } from "./recordSchema.ts";
import type { Finding } from "./reviewStep.ts";
import { axes, type Axis, type Verdict, verdicts } from "./verdicts.ts";

// docs/agents/verdicts.md defines each reason.
const dismissReasons = [
  "false-positive",
  "covered-later",
  "kept",
  "tooling-enforced",
  "serves-spec",
] as const;
const proposeReasons = ["decision", "ticket"] as const;

export type DismissReason = (typeof dismissReasons)[number];
export type ProposeReason = (typeof proposeReasons)[number];

// Named later tickets, each `<repo>#<n>`, plus their downstream; or the whole spec.
export type HaltScope = "spec" | string[];

// What the schema guarantees; resolveRecordProblems() checks which fields each verdict needs.
export interface ResolveRecord {
  // The finding's number in the review's list, from 1.
  finding: number;
  axis: Axis;
  // The reviewer's, set by the runner; absent for a finding saved before #362.
  suggestedVerdict?: Verdict;
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

// How any resolver judges, shared with the implementer through implementBody.resolving.
export const resolveRules =
  "Give each finding exactly one verdict, Dismiss, Fix, Propose or Halt, by the rules in `docs/agents/verdicts.md`; read it before you judge. Fix by default, and Dismiss, Propose or Halt only where that doc says, with evidence. You may overrule a reviewer's suggested verdict, saying why in `evidence`, except that a suggested Halt resolves only as a Halt or a Propose `decision`. The Fixes land together in one commit, its message naming each finding by number.";

// The resolve prompt's and the /implement-code skill's one description of a record, after "Return `records`, ".
export const resolveRecordFields = `exactly one record per finding: \`finding\` (its number in the list), \`axis\` (the finding's own, or for a finding without one, \`standards\` or \`spec\`), \`where\` (its file:line or area), \`claim\` (what the finding says, in a line), \`verdict\` (\`dismiss\`, \`fix\`, \`propose\` or \`halt\`), \`evidence\` (what you checked and found, and why, when you overruled the suggested verdict), and the fields its verdict needs:

- **Dismiss**: \`reason\`, one of ${codeListOf(dismissReasons)}; for \`covered-later\`, \`coveredBy\`, the later ticket as \`<repo>#<n>\`; for \`kept\`, \`quote\`, the site's reason with its file:line.
- **Fix**: \`quote\`, the quoted code or text, with its file:line, and \`rule\`, the documented rule or spec line it breaks.
- **Propose**: \`reason\`, ${codeListOf(proposeReasons)}, and \`recommendation\`; for \`ticket\`, \`draftIssueTitle\`; for a \`decision\` asking the developer's yes to a new keep, \`draftKeepReason\`, the drafted one-line reason.
- **Halt**: \`recommendation\`, and \`haltScope\`, the later tickets it blocks as \`<repo>#<n>\`, or \`spec\`; omit it to block the whole spec.`;

export interface ResolvePromptInput {
  issue: IssueRef;
  title: string;
  branch: string;
  branchedRepos: string[];
  // As the review record lists them; the prompt numbers them from 1.
  findings: Finding[];
}

export function resolvePrompt({
  issue,
  title,
  branch,
  branchedRepos,
  findings,
}: ResolvePromptInput): string {
  return `You are the resolve step of an unattended run. Nobody is watching this session: never ask a question or wait for an answer.

The review of ${issue.repo}#${issue.number}, "${title}", reported the findings below, each with its axis and its reviewer's suggested verdict. ${resolveRules} Your working directory is the ticket's issue workspace root; these repos are on the ticket's branch, \`${branch}\`: ${branchedRepos.join(", ")}. Change only those repos. Verify each finding against the code, the ticket and its spec before you judge it. ${stepReadLine}

## How you work

- Read and search with the Read and Grep tools. Give Bash one command per call, run from the workspace root: no \`cd\`, no \`;\` or \`&&\` chains, no variables.
- ${stepWriteLine}
- Fixes go on the ticket's branch, separate from the implement commit. Commit nothing when no finding is a Fix.
- Once the fixes are in, run \`npm run check\`. When it fails on a fix, fix it in a further commit and run it again. A fix you can't turn green, or one that would reverse a spec decision, is reverted in a further commit and resolved, saying why, as a Propose \`decision\`, or for a \`spec\`-axis finding as a Halt scoped to the downstream tickets. When it fails only on something your fixes didn't cause, return your records anyway; the runner's checks step stops on it.
- When two fixes are equally good, pick one and say which in the commit message.
- Never amend, push, merge, rebase or reset, never comment on, file or close an issue, and never run the wrap-up. The runner acts on your Propose and Halt verdicts.

## The record

Return \`records\`, ${resolveRecordFields}

## Findings

${numberedFindingsOf(findings)}`;
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

export interface ResolveCommits {
  records: ResolveRecord[];
  // Whether the committed tree differs from the one the resolve started on; a reverted fix leaves it unchanged.
  hasChangedTree: boolean;
  // The repos the resolver left uncommitted changes in.
  dirtyRepos: string[];
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

function findingProblem(finding: number, rule: string): string {
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

// A Halt with no scope blocks the whole spec: the safe default when the resolver is unsure.
export function haltScopeOf(record: ResolveRecord): HaltScope {
  return record.haltScope ?? "spec";
}

const caughtLabels = {
  fix: "Fixed",
  propose: "Proposed",
  halt: "Halted",
} as const satisfies Partial<Record<Verdict, string>>;

// The outcome row's text; undefined when the review kept nothing.
export function whatReviewCaughtOf(
  records: ResolveRecord[],
): string | undefined {
  const groups = Object.entries(caughtLabels).flatMap(([verdict, label]) => {
    const caught = records
      .filter((record) => record.verdict === verdict)
      .map(({ claim, where }) => `${claim} (${where})`);
    return caught.length === 0 ? [] : [`${label}: ${caught.join("; ")}.`];
  });
  return groups.length === 0 ? undefined : groups.join(" ");
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
