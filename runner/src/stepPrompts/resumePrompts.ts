// The prompts sent with --resume once a step is cut off, capped or sent back, or to the implementer for a handoff at a
// step boundary, and the note a tree reset adds to them.

import {
  bulletListOf,
  sessionReturnOf,
  unattendedRunLine,
} from "../promptText.ts";

// Sent with --resume once a step crosses the live ceiling without handing off.
export const handoffOnlyPrompt = `Stop now. ${sessionReturnOf(["record"])}, a handoff record; change no files.`;

// Sent with --resume at a step boundary once the implementer is past the ticket budget, while its cache is still warm.
export const budgetHandoffPrompt = `You are past the ticket budget, so a fresh session takes this ticket's next step. Change no files. ${sessionReturnOf(["record"])}, a handoff record whose conclusion says what is done and what that step should do.`;

// Sent with --resume once the launch check gives an account under its thresholds after a usage limit cut a step off.
export const limitResumePrompt = `A usage limit cut the previous run off; you now run on an account clear of it. Check the tree you left and carry on where you stopped. ${unattendedRunLine()}`;

// Sent with --resume on a `retry record` answer, after a record failed its check once the step had committed.
export const recordOnlyPrompt = `Your implement record failed the runner's check. Change no files. ${sessionReturnOf(["record"])}, the implement record again, matching the schema, with each branch's current sha. ${unattendedRunLine()}`;

const schemaResumeOpening = "Your record failed the runner's schema check:";

// Sent with --resume once, when the record a step returned fails the runner's schema check.
export function schemaResumePromptOf(problems: string[]): string {
  const listed = bulletListOf(problems);
  return `${schemaResumeOpening}\n\n${listed}\n\nChange no files. Return the record again, corrected to match this step's schema. ${unattendedRunLine()}`;
}

// A crash retry or limit resume of a resume that owes only a record sends the same prompt again.
export function isRecordOnlyResumePrompt(prompt: string): boolean {
  return (
    prompt === handoffOnlyPrompt ||
    prompt === budgetHandoffPrompt ||
    prompt.startsWith(schemaResumeOpening)
  );
}

export const treeResetNote =
  "Any uncommitted work was set aside on a backup branch and the tree reset to its last commit, so check what is committed first.";

// Sent with --resume on a `resume +N turns` answer, after the step hit its turn cap.
export function moreTurnsPrompt(turns: number, isTreeReset: boolean): string {
  const resetNote = isTreeReset ? ` ${treeResetNote}` : "";
  return `You hit your turn cap; the developer gave you ${turns} more turns.${resetNote} Finish the ticket as before. ${sessionReturnOf(["record"])}, the implement record. ${unattendedRunLine()}`;
}
