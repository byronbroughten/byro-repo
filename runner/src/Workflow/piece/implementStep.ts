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
  stepOpeningOf,
  stepWriteLine,
  unattendedRunLine,
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
import { doneLines } from "../../stepPrompts/doneLines.ts";
import { handoffText } from "../../stepPrompts/handoffText.ts";
import {
  implementBody,
  implementWorkspaceSection,
} from "../../stepPrompts/implementText.ts";
import {
  implementRecordOf,
  implementRecordProblems,
  type PieceImplementRecord,
} from "../../stepRecords.ts";
import type { ImplementPromptInput } from "../../Workflow.ts";
import { agentDraft } from "./agentDraft.ts";
import { draftingScope } from "./draftingScope.ts";

const paths = {
  voice: "docs/writing-voice.md",
  craft: "docs/writing-craft.md",
  pieceRules: "docs/pieces/rules.md",
  agentDraft: "docs/pieces/agent-draft.md",
} as const;

// How the record and its check name a Section, once for both.
const sectionNameText =
  "its heading path as the Agent draft holds it: `<H1> › <H2>` for an H2 under an H1, the H1's text alone for an H1's own Section, and the H2's text alone before any H1";

interface PassagesTicket extends Omit<IssueRef, "number"> {
  number: NumberOrPlaceholder;
}

// What each piece step's opening adds after its step's name.
export const draftingTicketKind = " on a piece spec's drafting ticket";

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

// The resolve and red-checks prompts' words for the images a fix may change, and every drafting step's for how it
// commits them.
export const draftImageWords = {
  developerImage: "an image with no SVG source beside it",

  agentImagesOf(specNumber: number): string {
    return `the agent's own images in the image folder, \`${agentDraft.imageFolderOf(specNumber)}\`, those with an SVG source beside them`;
  },

  commitOf(specNumber: NumberOrPlaceholder): string {
    return `\`git -C <clone> add ${agentDraft.imageFolderOf(specNumber)}\` when you added or changed an image there`;
  },
};

export interface DraftingWords {
  draftPath: string;
  specRepo: string;
  specNumber: NumberOrPlaceholder;
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
  specNumber,
  specRef,
  sections,
  passagesFolder,
  pulled,
}: DraftingWords): string[] {
  return [
    `The Agent draft is \`${draftPath}\` in the \`${specRepo}\` clone. ${pulled} Its file format is in \`${paths.agentDraft}\`.`,
    `The ticket's spec is ${specRef}; read its body for the Deliverable, the Reader, the Outline, the Supporting Material and the Images.`,
    `Draft by the rules under "Implementing a piece spec" in \`${paths.pieceRules}\`, writing to the Agent draft and never the Deliverable's Doc.`,
    `Draft only ${sections}, each under its heading as the draft holds it, with its mark on the line under the heading: \`<!-- agent -->\`, or \`<!-- agent <headingId> -->\` where the draft's mark holds an ID. Copy a mark unchanged, its ID included. Change no other Section, never one marked \`<!-- developer -->\`, and no file outside the Agent draft and its image folder. A Section never needs a renamed or invented heading: keep every heading as the draft holds it, and a heading repeated under another H1 is told apart by its path.`,
    `Read \`${paths.voice}\` and \`${paths.craft}\` in full before your first prose edit.`,
    "Read the spec's Supporting Material only through the Drive read tools you were given, by the file IDs the spec lists.",
    `The image folder is \`${agentDraft.imageFolderOf(specNumber)}\`. For each image the spec's Images field gives a Section you draft: draw an agent image as SVG source in the image folder and render it to PNG with \`npm run image:render -- <svg file>\`; download a developer image through the Drive read tools, by the file ID the Images field gives, save it in the image folder, and never edit it.`,
    `Write each such image's Image placeholder in its Section by the File format in \`${paths.agentDraft}\`, naming its PNG, or listing its facts while it has no file yet. Its facts are outside the Facts field: use in your prose only the values the Outline names for it.`,
    `Save each passage you read once, as a text file in the passages folder, \`${passagesFolder}\`, named for its source and range. Review, resolve and any fresh step after a handoff read the same files, so read a source again only for a passage the folder lacks. The folder is gitignored; never copy a passage into the repo.`,
    implementBody.batching,
  ];
}

export function commitDraftLineOf({
  draftPath,
  specRepo,
  specNumber,
}: Pick<DraftingWords, "draftPath" | "specRepo" | "specNumber">): string {
  return `Commit only the Agent draft and its image folder's files, in the \`${specRepo}\` clone on the ticket's branch: \`git -C <clone> add ${draftPath}\`, ${draftImageWords.commitOf(specNumber)}, then \`git -C <clone> commit\`. Never amend.`;
}

export const noGitHubWriteLine = "Make no GitHub write.";

export interface PieceImplementPromptInput extends ImplementPromptInput {
  draftPath: string;
}

export function pieceImplementPrompt(input: PieceImplementPromptInput): string {
  const { issue, title, body, latestHandoff } = input;
  return [
    `${stepOpeningOf("implement step", draftingTicketKind)} Draft ${issue.repo}#${issue.number}, "${title}". ${unattendedRunLine()}`,
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
      specNumber: spec.number,
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

- ${commitDraftLineOf({ draftPath, specRepo: spec.repo, specNumber: spec.number })}
- That commit is your only write outside the workspace's files: never push, merge, rebase or reset, never close an issue, and never run the wrap-up. Don't call a review; the runner reviews after you.
- ${doneLines.implement}
  - \`status\`: \`committed\`; or \`blocked\` when a blocker stopped you before any commit.
  - \`branches\`: the \`${spec.repo}\` clone's branch and its last commit's sha. Empty unless committed.
  - \`sectionsDrafted\`: every Section your commit holds, those a handoff left you included, each named by ${sectionNameText}.
  - \`closingComment\`: what you drafted, for the ticket's closing comment.
  - \`boxesUndone\`: each acceptance box you left undone, with why.
  - \`blockers\`: each blocker, as above.`;
}

function handoffSection({ draftPath }: PieceImplementPromptInput): string {
  return handoffText.nudgeSectionOf({
    noJudgementLeft: "no paragraph is left to draft",
    inHand: "paragraph",
    filesToOpen: `\`${draftPath}\` with the line range you were drafting, and each passage file you saved, with \`1-\` and its last line`,
    stillFailing: "empty",
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

export interface DraftedScope {
  // A final-pass ticket scopes every agent Section, so its record's names don't.
  isFinalPass: boolean;
  // The Agent draft as the ticket's branch holds it; called only for a committed record.
  draftOf(): string;
}

// Checks the output against its schema too, since only the real adapter does, then code's commit check, then that each
// Section the record names is in the committed Agent draft, since the piece checks scope by those names.
export function pieceImplementRecordProblems(
  output: unknown,
  hasNewCommit: boolean,
  { isFinalPass, draftOf }: DraftedScope,
): string[] {
  const problems = schemaProblemsOf(pieceImplementOutputSchema, output);
  if (problems.length > 0) return problems;
  const record = implementRecordOf<PieceImplementRecord>(output);
  const commitProblems = implementRecordProblems(record, hasNewCommit);
  if (commitProblems.length > 0 || record.status !== "committed") {
    return commitProblems;
  }
  if (isFinalPass) return [];
  const held = agentDraft.sectionsOf(draftOf()).map(({ path }) => path);
  return record.sectionsDrafted
    .filter((name) => !held.includes(name))
    .map(
      (name) =>
        `sectionsDrafted names "${name}", which the committed Agent draft has no Section of; use ${sectionNameText}`,
    );
}
