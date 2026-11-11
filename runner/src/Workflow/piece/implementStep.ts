// The piece implement step: the prompt the runner sends a drafting ticket once pull has committed the Agent draft, and
// the record it returns, code's implement record plus the Sections drafted. Its handoff is code's, through
// ../../stepPrompts/handoffText.ts, and so is the core's handling of it in ../../SpecRun/ImplementStepper.ts.
// `/implement-piece` is generated from its drafting lines, by implementPieceSkill.ts; pieceWorkflow.ts registers the step.

import { join } from "node:path";

import { stepReadLine } from "../../IssueReader.ts";
import type { IssueRef } from "../../IssueWorkspaces.ts";
import {
  commitMessageLine,
  type NumberOrPlaceholder,
  sectionOf,
  stepWriteLine,
} from "../../promptText.ts";
import {
  arraySchema,
  branchSchema,
  implementVariantSchema,
  objectSchema,
  schemaProblemsOf,
  stringSchema,
  uncommittedVariantSchemas,
} from "../../recordSchema.ts";
import { handoffText } from "../../stepPrompts/handoffText.ts";
import {
  implementBody,
  implementWorkspaceSection,
} from "../../stepPrompts/implementText.ts";
import {
  implementRecordOf,
  implementRecordProblems,
} from "../../stepRecords.ts";
import type { ImplementPromptInput } from "../../Workflow.ts";
import { draftingScope } from "./draftingScope.ts";

const paths = {
  voice: "docs/writing-voice.md",
  craft: "docs/writing-craft.md",
  pieceRules: "docs/pieces/rules.md",
  agentDraft: "docs/pieces/agent-draft.md",
} as const;

interface PassagesTicket extends Omit<IssueRef, "number"> {
  number: NumberOrPlaceholder;
}

// Under the workspace root's `.runner/`, which byro-repo gitignores, so no passage reaches a commit.
export function passagesFolderOf({ repo, number }: PassagesTicket): string {
  return `.runner/passages/${repo}-${number}`;
}

export function passagesFolderIn(
  workspacePath: string,
  issue: IssueRef,
): string {
  return join(workspacePath, passagesFolderOf(issue));
}

interface DraftMaterials {
  issue: IssueRef;
  spec: IssueRef;
  workspacePath: string;
  draftPath: string;
}

// The resolve and red-checks prompts' line naming what a fix reads and writes.
export function draftMaterialsLineOf({
  issue,
  spec,
  workspacePath,
  draftPath,
}: DraftMaterials): string {
  return `The Agent draft is \`${draftPath}\` in the \`${spec.repo}\` clone, the passages folder is \`${passagesFolderIn(workspacePath, issue)}\`, and the ticket's spec is ${spec.repo}#${spec.number}.`;
}

export interface DraftingWords {
  draftPath: string;
  specRepo: string;
  // Fits after "The ticket's spec is".
  specRef: string;
  // Fits after "Draft only".
  sections: string;
  passagesFolder: string;
  // Fits after the sentence naming the Agent draft: how it came to hold the Doc.
  pulled: string;
}

export function draftingLinesOf({
  draftPath,
  specRepo,
  specRef,
  sections,
  passagesFolder,
  pulled,
}: DraftingWords): string[] {
  return [
    `The Agent draft is \`${draftPath}\` in the \`${specRepo}\` clone. ${pulled} Its file format is in \`${paths.agentDraft}\`.`,
    `The ticket's spec is ${specRef}; read its body for the Deliverable, the Reader, the Outline and the Supporting Material.`,
    `Draft by the rules under "Implementing a piece spec" in \`${paths.pieceRules}\`, writing to the Agent draft and never the Deliverable's Doc.`,
    `Draft only ${sections}, each under its heading as the draft holds it, with \`<!-- agent -->\` on the line under the heading. Change no other Section, never one marked \`<!-- developer -->\`, and no other file.`,
    `Read \`${paths.voice}\` and \`${paths.craft}\` in full before your first prose edit.`,
    "Read the spec's Supporting Material only through the Drive read tools you were given, by the file IDs the spec lists.",
    `Save each passage you read once, as a text file in the passages folder, \`${passagesFolder}\`, named for its source and range. Review, resolve and any fresh step after a handoff read the same files, so read a source again only for a passage the folder lacks. The folder is gitignored; never copy a passage into the repo.`,
  ];
}

export function commitDraftLineOf({
  draftPath,
  specRepo,
}: Pick<DraftingWords, "draftPath" | "specRepo">): string {
  return `Commit only the Agent draft, in the \`${specRepo}\` clone on the ticket's branch: ${draftCommitCommandsOf(draftPath)}. Never amend.`;
}

export function draftCommitCommandsOf(draftPath: string): string {
  return `\`git -C <clone> add ${draftPath}\`, then \`git -C <clone> commit\``;
}

export const noGitHubWriteLine = "Make no GitHub write.";

export interface PieceImplementPromptInput extends ImplementPromptInput {
  draftPath: string;
}

export function pieceImplementPrompt(input: PieceImplementPromptInput): string {
  const { issue, title, body, latestHandoff } = input;
  return [
    `You are the implement step of an unattended run on a piece spec's drafting ticket. Draft ${issue.repo}#${issue.number}, "${title}". Nobody is watching this session: never ask a question or wait for an answer.`,
    implementWorkspaceSection(input),
    draftingSection(input),
    `## GitHub\n\n- ${noGitHubWriteLine}\n- ${stepReadLine}`,
    workingSection(),
    finishingSection(input),
    handoffSection(input),
    ...(latestHandoff ? [handoffText.previousSectionOf(latestHandoff)] : []),
    `## The ticket\n\n${body}`,
  ].join("\n\n");
}

function draftingSection({
  issue,
  spec,
  labels,
  draftPath,
  workspacePath,
}: PieceImplementPromptInput): string {
  return sectionOf(
    "What you draft",
    draftingLinesOf({
      draftPath,
      specRepo: spec.repo,
      specRef: `${spec.repo}#${spec.number}`,
      sections: draftingScope.sectionsOf(labels),
      passagesFolder: passagesFolderIn(workspacePath, issue),
      pulled:
        "The runner's pull already brought the Deliverable's Doc into it and committed it on the ticket's branch.",
    }),
  );
}

function workingSection(): string {
  return sectionOf("How you work", [
    implementBody.oneCommand,
    stepWriteLine,
    commitMessageLine,
    "Never ask. When the ticket is ambiguous, a source can't be read or a tool is denied, record it as a blocker (`spec-ambiguity`, `gated-action` or `denied-tool`) with what happened and what you recommend the developer do. Carry on with the reading the ticket best supports when the drafting can go on without it; otherwise stop with status `blocked`.",
  ]);
}

function finishingSection({
  spec,
  draftPath,
}: PieceImplementPromptInput): string {
  return `## When you're done

- ${commitDraftLineOf({ draftPath, specRepo: spec.repo })}
- That commit is your only write outside the workspace's files: never push, merge, rebase or reset, never close an issue, and never run the wrap-up. Don't call a review; the runner reviews after you.
- Then stop and return the implement record as \`record\`:
  - \`status\`: \`committed\`; or \`blocked\` when a blocker stopped you before any commit.
  - \`branches\`: the \`${spec.repo}\` clone's branch and its last commit's sha. Empty unless committed.
  - \`sectionsDrafted\`: the exact heading text of every Section your commit holds, those a handoff left you included, as the Agent draft holds it, without the \`## \`.
  - \`closingComment\`: what you drafted, for the ticket's closing comment.
  - \`boxesUndone\`: each acceptance box you left undone, with why.
  - \`blockers\`: each blocker, as above.`;
}

function handoffSection({ draftPath }: PieceImplementPromptInput): string {
  return handoffText.nudgeSectionOf({
    inHand: "paragraph",
    filesToOpen: `\`${draftPath}\` with the line range you were drafting, and each passage file you saved, with \`1-\` and its last line`,
    stillFailing: "empty",
    splitWhen: "the ticket's Sections are drafted",
    slices: `one slice per Section left, each \`delivers\` naming its Section and \`files\` listing \`${draftPath}\``,
  });
}

// One variant per status, so only the status that needs a field carries it; a drafting ticket has no applied record.
const recordVariantsSchema = {
  oneOf: [
    implementVariantSchema("committed", {
      branches: arraySchema(branchSchema, { minItems: 1 }),
      sectionsDrafted: arraySchema(stringSchema, { minItems: 1 }),
    }),
    uncommittedVariantSchemas.blocked,
    uncommittedVariantSchemas.handoff,
  ],
};

// The API refuses a top-level oneOf in a tool's input schema, so the record sits under `record`.
export const pieceImplementOutputSchema = objectSchema({
  record: recordVariantsSchema,
});

// Checks the output against its schema too, since only the real adapter does, then code's commit check.
export function pieceImplementRecordProblems(
  output: unknown,
  hasNewCommit: boolean,
): string[] {
  const problems = schemaProblemsOf(pieceImplementOutputSchema, output);
  if (problems.length > 0) return problems;
  return implementRecordProblems(implementRecordOf(output), hasNewCommit);
}
