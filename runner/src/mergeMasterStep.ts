// The merge-master step's prompt and record; SpecRun.ts runs it once on a wrap-up conflict.

import { stepReadLine } from "./IssueReader.ts";
import type { IssueRef } from "./IssueWorkspaces.ts";
import { commitMessageLine } from "./promptText.ts";
import { arraySchema, objectSchema, stringSchema } from "./recordSchema.ts";

export interface MergeMasterPromptInput {
  issue: IssueRef;
  title: string;
  branch: string;
  branchedRepos: string[];
  // The repos the runner left mid-merge.
  mergingRepos: string[];
  // The wrap-up's conflict message.
  conflict: string;
}

export function mergeMasterPrompt({
  issue,
  title,
  branch,
  branchedRepos,
  mergingRepos,
  conflict,
}: MergeMasterPromptInput): string {
  return `You are the merge-master step of an unattended run. Nobody is watching this session: never ask a question or wait for an answer.

Landing ${issue.repo}#${issue.number}, "${title}", conflicted with master, which moved since the ticket branched. Your working directory is the ticket's issue workspace root; these repos are on the ticket's branch, \`${branch}\`: ${branchedRepos.join(", ")}. Change only those repos. ${stepReadLine}

## How you work

- Read and search with the Read and Grep tools. Give Bash one command per call, run from the workspace root: no \`cd\`, no \`;\` or \`&&\` chains, no variables.
- The runner has already started the merge of \`master\`, and it's in progress in ${mergingRepos.join(", ")}, with its conflicts in place.
- Resolve each conflict with Read, Edit and Write, keeping both sides' intent.
- Then \`git add\` each resolved file, \`git commit --no-edit\`, and run \`npm run check\` until it passes, committing any fix.
- When you can't tell how a conflict should be resolved, don't guess: set \`unsure\` to each file and the question it raises, and commit nothing.
- Never run \`git merge\`, \`git merge --abort\`, \`git checkout\`, \`git restore\`, \`git reset\` or \`git rebase\`: the sandbox blocks a git write to \`.claude/\` files, and the runner owns the merge.
- Never amend or push, never comment on or close an issue, and never run the wrap-up.
- ${commitMessageLine}

## When you're done

Return \`summary\`, one or two sentences on what conflicted and how you resolved it, and \`files\`, each file that conflicted as \`<repo> <path>\`, adding \`unsure\` only when you couldn't tell.

## The conflict

The wrap-up reported this on its own merge, which it aborted; the merge in progress is the runner's, of \`master\` into the ticket's branch.

${conflict}`;
}

export interface MergeMasterRecord {
  summary: string;
  files: string[];
  // Each file the step couldn't resolve and the question it raises.
  unsure?: string;
}

export const mergeMasterOutputSchema = objectSchema(
  {
    summary: stringSchema,
    files: arraySchema(stringSchema, { minItems: 1 }),
    unsure: stringSchema,
  },
  { optional: ["unsure"] },
);
