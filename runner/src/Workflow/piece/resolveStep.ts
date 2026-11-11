// The piece resolve step: the prompt that settles a drafting ticket's review findings under `## Piece findings` in the
// verdict rules, fixing only the ticket's Sections of the Agent draft, and the record checks that add the piece rules
// to code's. Its record and the rest of its checks are the core's, from ../../resolveRecords.ts; pieceWorkflow.ts registers it.

import { join } from "node:path";

import { stepReadLine } from "../../IssueReader.ts";
import {
  commitMessageLine,
  sectionOf,
  stepWriteLine,
} from "../../promptText.ts";
import {
  findingProblem,
  numberedFindingsOf,
  resolveRecordProblems,
} from "../../resolveRecords.ts";
import {
  implementBody,
  resolveRecordFields,
  resolveRules,
} from "../../stepPrompts.ts";
import type {
  DismissReason,
  ProposeReason,
  ResolveRecord,
} from "../../stepRecords.ts";
import type { Verdict } from "../../verdicts.ts";
import type { ResolvePromptInput } from "../../Workflow.ts";
import { passagesFolderOf } from "./implementStep.ts";

const pieceFindingsHeading = "## Piece findings";

interface UnusedReason {
  verdict: Verdict;
  verdictName: string;
  reason: DismissReason | ProposeReason;
}

// The verdict reasons a piece finding never takes, as the verdict rules' piece section lists them.
const unusedReasons: UnusedReason[] = [
  { verdict: "propose", verdictName: "Propose", reason: "ticket" },
  { verdict: "dismiss", verdictName: "Dismiss", reason: "kept" },
  { verdict: "dismiss", verdictName: "Dismiss", reason: "tooling-enforced" },
];

export interface PieceResolvePromptInput extends ResolvePromptInput {
  draftPath: string;
}

export function pieceResolvePrompt(input: PieceResolvePromptInput): string {
  const { issue, title, branch, findings } = input;
  return [
    `You are the resolve step of an unattended run on a piece spec's drafting ticket. Nobody is watching this session: never ask a question or wait for an answer.

The review of ${issue.repo}#${issue.number}, "${title}", reported the findings below, each with its axis and its reviewer's suggested verdict. ${resolveRules} A piece finding's verdict follows the \`${pieceFindingsHeading}\` section of that doc. Your working directory is the ticket's issue workspace root, on the ticket's branch, \`${branch}\`. ${stepReadLine}`,
    fixingSection(input),
    workingSection(input),
    `## The record\n\nReturn \`records\`, ${resolveRecordFields}`,
    `## Findings\n\n${numberedFindingsOf(findings)}`,
  ].join("\n\n");
}

function fixingSection({
  issue,
  spec,
  draftPath,
  workspacePath,
}: PieceResolvePromptInput): string {
  const passagesFolder = join(workspacePath, passagesFolderOf(issue));
  return sectionOf("What you fix", [
    `The Agent draft is \`${draftPath}\` in the \`${spec.repo}\` clone, the passages folder is \`${passagesFolder}\`, and the ticket's spec is ${spec.repo}#${spec.number}. Verify each finding against the Agent draft, the saved passages, the ticket and its spec before you judge it.`,
    "A fix touches only the Agent draft and only the Sections this ticket drafted, every agent Section on a final pass: never a Section marked `<!-- developer -->`, the spec, the fact list or a Research comment.",
  ]);
}

function workingSection({ spec, draftPath }: PieceResolvePromptInput): string {
  return sectionOf("How you work", [
    implementBody.oneCommand,
    stepWriteLine,
    commitMessageLine,
    `Commit the Fixes on the ticket's branch, separate from the implement commit: \`git -C <clone> add ${draftPath}\` in the \`${spec.repo}\` clone, then \`git -C <clone> commit\`. Commit nothing when no finding is a Fix.`,
    "A fix that would reverse a spec decision is reverted in a further commit and resolved, saying why, as a Propose `decision`, or for a `spec`-axis finding as a Halt scoped to the downstream tickets.",
    "Never amend, push, merge, rebase or reset, never comment on, file or close an issue, and never run the wrap-up. The runner acts on your Propose and Halt verdicts.",
  ]);
}

// Code's checks, then the reasons a piece finding never takes.
export function pieceResolveRecordProblems(
  findingCount: number,
  records: ResolveRecord[],
): string[] {
  return [
    ...resolveRecordProblems(findingCount, records),
    ...records.flatMap(unusedReasonProblems),
  ];
}

function unusedReasonProblems({
  finding,
  verdict,
  reason,
}: ResolveRecord): string[] {
  const unused = unusedReasons.find(
    (each) => each.verdict === verdict && each.reason === reason,
  );
  if (unused === undefined) return [];
  return [
    findingProblem(
      finding,
      `a piece finding never takes a ${unused.verdictName} \`${unused.reason}\``,
    ),
  ];
}
