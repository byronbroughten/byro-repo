// The prompts sent with --resume once a step is cut off, capped or sent back, and the note a tree reset adds to them.

import {
  bulletListOf,
  sessionReturnOf,
  unattendedRunLine,
} from "../promptText.ts";

// Sent with --resume once a step crosses the live ceiling without handing off.
export const handoffOnlyPrompt = `Stop now. ${sessionReturnOf(["record"])}, a handoff record; change no files.`;

// Sent with --resume once a usage limit that cut a step off has reset or the Active account has changed.
export const limitResumePrompt = `A usage limit cut the previous run off; it has passed. Check the tree you left and carry on where you stopped. ${unattendedRunLine()}`;

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
  return prompt === handoffOnlyPrompt || prompt.startsWith(schemaResumeOpening);
}

export const treeResetNote =
  "Any uncommitted work was set aside on a backup branch and the tree reset to its last commit, so check what is committed first.";

// Sent with --resume on a `resume +N turns` answer, after the step hit its turn cap.
export function moreTurnsPrompt(turns: number, isTreeReset: boolean): string {
  const resetNote = isTreeReset ? ` ${treeResetNote}` : "";
  return `You hit your turn cap; the developer gave you ${turns} more turns.${resetNote} Finish the ticket as before. ${sessionReturnOf(["record"])}, the implement record. ${unattendedRunLine()}`;
}
