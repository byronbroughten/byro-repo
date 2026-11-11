// The prompts sent with --resume once a step is cut off, capped or sent back, and the note a tree reset adds to them.

// Sent with --resume once a step crosses the live ceiling without handing off.
export const handoffOnlyPrompt =
  "Stop now; return a handoff record only, no file changes.";

// Sent with --resume once a usage limit that cut a step off has reset or the Active account has changed.
export const limitResumePrompt =
  "A usage limit cut the previous run off; it has passed. Check the tree you left and carry on where you stopped. Nobody is watching this session: never ask a question or wait for an answer.";

// Sent with --resume on a `retry record` answer, after a record failed its check once the step had committed.
export const recordOnlyPrompt =
  "Your implement record failed the runner's check. Change no files: return the implement record again, matching the schema, with each branch's current sha. Nobody is watching this session: never ask a question or wait for an answer.";

export const treeResetNote =
  "Any uncommitted work was set aside on a backup branch and the tree reset to its last commit, so check what is committed first.";

// Sent with --resume on a `resume +N turns` answer, after the step hit its turn cap.
export function moreTurnsPrompt(turns: number, isTreeReset: boolean): string {
  const resetNote = isTreeReset ? ` ${treeResetNote}` : "";
  return `You hit your turn cap; the developer gave you ${turns} more turns.${resetNote} Finish the ticket as before and return the implement record. Nobody is watching this session: never ask a question or wait for an answer.`;
}
