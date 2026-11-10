// The piece implement step: the prompt the runner sends a drafting ticket once pull has committed the Agent draft, and
// the record it returns, code's implement record plus the Sections drafted. Its handoff is code's, through
// ../../stepPrompts/handoffText.ts, and so is the core's handling of it in ../../SpecRun/ImplementStepper.ts.
// Its strings live here so `/implement-piece` can later be generated from them; pieceWorkflow.ts registers them.

import { join } from "node:path";

import { stepReadLine } from "../../IssueReader.ts";
import type { IssueRef } from "../../IssueWorkspaces.ts";
import {
  commitMessageLine,
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
import { implementBody, implementWorkspaceSection } from "../../stepPrompts.ts";
import { handoffText } from "../../stepPrompts/handoffText.ts";
import {
  implementRecordOf,
  implementRecordProblems,
} from "../../stepRecords.ts";
import type { ImplementPromptInput } from "../../Workflow.ts";

const paths = {
  voice: "docs/writing-voice.md",
  craft: "docs/writing-craft.md",
  pieceRules: "docs/pieces/rules.md",
  agentDraft: "docs/pieces/agent-draft.md",
} as const;

// Under the workspace root's `.runner/`, which byro-repo gitignores, so no passage reaches a commit.
export function passagesFolderOf({ repo, number }: IssueRef): string {
  return `.runner/passages/${repo}-${number}`;
}

export interface PieceImplementPromptInput extends ImplementPromptInput {
  draftPath: string;
}

export function pieceImplementPrompt(input: PieceImplementPromptInput): string {
  const { issue, title, body, latestHandoff } = input;
  return [
    `You are the implement step of an unattended run on a piece spec's drafting ticket. Draft ${issue.repo}#${issue.number}, "${title}". Nobody is watching this session: never ask a question or wait for an answer.`,
    implementWorkspaceSection(input),
    draftingSection(input),
    `## GitHub\n\n- Make no GitHub write.\n- ${stepReadLine}`,
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
  draftPath,
  workspacePath,
}: PieceImplementPromptInput): string {
  const passagesFolder = join(workspacePath, passagesFolderOf(issue));
  return sectionOf("What you draft", [
    `The Agent draft is \`${draftPath}\` in the \`${spec.repo}\` clone. The runner's pull already brought the Deliverable's Doc into it and committed it on the ticket's branch. Its file format is in \`${paths.agentDraft}\`.`,
    `The ticket's spec is ${spec.repo}#${spec.number}; read its body for the Deliverable, the Reader, the Outline and the Supporting Material.`,
    `Draft by the rules under "Implementing a piece spec" in \`${paths.pieceRules}\`, writing to the Agent draft and never the Deliverable's Doc.`,
    `Draft only the Sections this ticket names, each under its heading as the draft holds it, with \`<!-- agent -->\` on the line under the heading. Change no other Section and no other file.`,
    `Read \`${paths.voice}\` and \`${paths.craft}\` in full before your first prose edit.`,
    "Read the spec's Supporting Material only through the Drive read tools you were given, by the file IDs the spec lists.",
    `Save each passage you read once, as a text file in the passages folder, \`${passagesFolder}\`, named for its source and range. Review, resolve and any fresh step after a handoff read the same files, so read a source again only for a passage the folder lacks. The folder is gitignored; never copy a passage into the repo.`,
  ]);
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

- Commit only the Agent draft, in the \`${spec.repo}\` clone on the ticket's branch: \`git -C <clone> add ${draftPath}\`, then \`git -C <clone> commit\`. Never amend.
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
