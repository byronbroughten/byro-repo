// The piece resolve step: the prompt that settles a drafting ticket's review findings under `## Piece findings` in the
// verdict rules, fixing only the ticket's Sections of the Agent draft and rerunning the piece checks, from pieceChecks.ts,
// after its Fixes, and the record checks that add the piece rules to code's. Its record and the rest of its checks are the core's, from ../../resolveRecords.ts; pieceWorkflow.ts registers it.

import { stepReadLine } from "../../IssueReader.ts";
import {
  commitMessageLine,
  sectionOf,
  stepWriteLine,
} from "../../promptText.ts";
import { findingProblem, resolveRecordProblems } from "../../resolveRecords.ts";
import type { Command } from "../../runKnobs.ts";
import { implementBody } from "../../stepPrompts/implementText.ts";
import { resolveBody } from "../../stepPrompts/resolveText.ts";
import type {
  DismissReason,
  ProposeReason,
  ResolveRecord,
} from "../../stepRecords.ts";
import { type Verdict, verdictWords } from "../../verdicts.ts";
import type { ResolvePromptInput } from "../../Workflow.ts";
import { draftingScope } from "./draftingScope.ts";
import { draftMaterialsLineOf, passagesFolderIn } from "./implementStep.ts";
import { pieceChecks } from "./pieceChecks.ts";

const pieceFindingsHeading = "## Piece findings";

interface UnusedReason {
  verdict: Verdict;
  reason: DismissReason | ProposeReason;
}

// The verdict reasons a piece finding never takes, as the verdict rules' piece section lists them.
const unusedReasons: UnusedReason[] = [
  { verdict: "propose", reason: "ticket" },
  { verdict: "dismiss", reason: "kept" },
  { verdict: "dismiss", reason: "tooling-enforced" },
];

export interface PieceResolvePromptInput extends ResolvePromptInput {
  draftPath: string;
  // The piece checks' overlap command, which the resolver reruns after its Fixes.
  overlapCommand: Command;
}

export function pieceResolvePrompt(input: PieceResolvePromptInput): string {
  const { branch, findings } = input;
  return [
    `You are the resolve step of an unattended run on a piece spec's drafting ticket. Nobody is watching this session: never ask a question or wait for an answer.

${resolveBody.findingsOf(input)} A piece finding's verdict follows the \`${pieceFindingsHeading}\` section of that doc. Your working directory is the ticket's issue workspace root, on the ticket's branch, \`${branch}\`. ${stepReadLine}`,
    fixingSection(input),
    workingSection(input),
    checksSection(input),
    dismissedOverlapsSection(input),
    resolveBody.recordAndFindingsOf(findings),
  ].join("\n\n");
}

function fixingSection(input: PieceResolvePromptInput): string {
  return sectionOf("What you fix", [
    `${draftMaterialsLineOf(input)} Verify each finding against the Agent draft, the saved passages, the ticket and its spec before you judge it.`,
    `A fix touches only the Agent draft and only ${draftingScope.sectionsOf(input.labels)}: never a Section marked \`<!-- developer -->\`, the spec, the fact list or a Research comment.`,
  ]);
}

// The runner's piece checks run after resolve, so a resolver that leaves them red sends the ticket to red-checks.
function checksSection({
  issue,
  spec,
  labels,
  workspacePath,
  overlapCommand,
}: PieceResolvePromptInput): string {
  const passagesFolder = passagesFolderIn(workspacePath, issue);
  return sectionOf("The piece checks after your Fixes", [
    `Once your Fixes are committed, rerun the overlap check from the workspace root: \`${pieceChecks.overlapRunOf({ overlapCommand, specRepo: spec.repo, passagesFolder })}\`.`,
    pieceChecks.overlapFixLineOf(
      `it prints in ${draftingScope.sectionsOf(labels)} that the dismissed hits below don't hold`,
    ),
    `${draftingScope.lengthRuleOf(labels)} ${draftingScope.lengthRuleClause}`,
    `A Fix you can't make pass the checks is reverted in a further commit and resolved, saying why, as a Propose \`decision\`, or for a \`spec\`-axis finding as a Halt, so you never leave the checks red.`,
  ]);
}

function dismissedOverlapsSection({
  dismissedOverlaps,
}: PieceResolvePromptInput): string {
  if (dismissedOverlaps.length === 0) {
    return "## Dismissed overlap hits\n\nReview dismissed no overlap hit.";
  }
  const lines = dismissedOverlaps.map(
    ({ hit, reason }) => `- ${hit}: ${reason}`,
  );
  return `## Dismissed overlap hits\n\n${lines.join("\n")}`;
}

function workingSection({ spec, draftPath }: PieceResolvePromptInput): string {
  return sectionOf("How you work", [
    implementBody.oneCommand,
    stepWriteLine,
    commitMessageLine,
    `Commit the Fixes on the ticket's branch, separate from the implement commit: \`git -C <clone> add ${draftPath}\` in the \`${spec.repo}\` clone, then \`git -C <clone> commit\`. ${resolveBody.commitNothing}`,
    `A fix that would reverse a spec decision ${resolveBody.revertedAs}`,
    resolveBody.onlyWrites,
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
      `a piece finding never takes a ${verdictWords[unused.verdict]} \`${unused.reason}\``,
    ),
  ];
}
