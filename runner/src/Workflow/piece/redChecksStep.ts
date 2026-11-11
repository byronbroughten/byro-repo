// The piece red-checks step: the prompt that hands a drafting ticket's red piece checks, from pieceChecks.ts, back to
// whoever made its last commit, and the summary it returns. pieceWorkflow.ts registers it, and
// ../../SpecRun/TicketLander/TicketChecker.ts runs it up to the `retriesPerFailure` knob's times; still red is a Failure Halt.

import { stepReadLine } from "../../IssueReader.ts";
import {
  commitMessageLine,
  sectionOf,
  unattendedRunLine,
} from "../../promptText.ts";
import { objectSchema, stringSchema } from "../../recordSchema.ts";
import { implementBody } from "../../stepPrompts.ts";
import type { RedChecksPromptInput } from "../../Workflow.ts";
import { draftMaterialsLineOf } from "./implementStep.ts";

export interface PieceRedChecksPromptInput extends RedChecksPromptInput {
  draftPath: string;
}

export function pieceRedChecksPrompt(input: PieceRedChecksPromptInput): string {
  const { issue, title, branch, failures } = input;
  return [
    `You are the red-checks step of an unattended run on a piece spec's drafting ticket. ${unattendedRunLine()}

The runner's piece checks failed on ${issue.repo}#${issue.number}, "${title}", after its last commit. Turn them green. Your working directory is the ticket's issue workspace root, on the ticket's branch, \`${branch}\`. ${stepReadLine}`,
    fixingSection(input),
    workingSection(input),
    "## When you're done\n\nReturn `summary`: one or two sentences on what was red and what you changed.",
    `## The failing checks\n\n${failures}`,
  ].join("\n\n");
}

function fixingSection(input: PieceRedChecksPromptInput): string {
  return sectionOf("What you fix", [
    draftMaterialsLineOf(input),
    "An overlap hit is wording an agent Section shares with a saved passage: reword it in the draft's own words, keeping its fact.",
    "A length failure is the agent Sections running over the spec's Form `Length:` line: cut them until they fit, keeping every fact the Outline assigns them.",
    "Change only the agent Sections an overlap hit names, or any agent Section for a length failure: never a Section marked `<!-- developer -->`, the spec or any other file.",
  ]);
}

function workingSection({
  spec,
  draftPath,
}: PieceRedChecksPromptInput): string {
  return sectionOf("How you work", [
    implementBody.oneCommand,
    commitMessageLine,
    `Commit only the Agent draft, on the ticket's branch: \`git -C <clone> add ${draftPath}\` in the \`${spec.repo}\` clone, then \`git -C <clone> commit\`. Never amend, push, merge, rebase or reset, never comment on or close an issue, and never run the wrap-up.`,
    "The runner reruns its checks once you return; still red, they raise a Failure Halt.",
  ]);
}

export const pieceRedChecksOutputSchema = objectSchema({
  summary: stringSchema,
});
