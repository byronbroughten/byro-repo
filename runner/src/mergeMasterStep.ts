// The merge-master step's prompt and record; SpecRun.ts runs it once on a wrap-up conflict.

import { stepReadLine } from "./IssueReader.ts";
import type { IssueRef } from "./IssueWorkspaces.ts";
import { arraySchema, objectSchema, stringSchema } from "./recordSchema.ts";

export interface MergeMasterPromptInput {
  issue: IssueRef;
  title: string;
  branch: string;
  branchedRepos: string[];
  // The wrap-up's conflict message.
  conflict: string;
}

export function mergeMasterPrompt({
  issue,
  title,
  branch,
  branchedRepos,
  conflict,
}: MergeMasterPromptInput): string {
  return `You are the merge-master step of an unattended run. Nobody is watching this session: never ask a question or wait for an answer.

Landing ${issue.repo}#${issue.number}, "${title}", conflicted with master, which moved since the ticket branched. Your working directory is the ticket's issue workspace root; these repos are on the ticket's branch, \`${branch}\`: ${branchedRepos.join(", ")}. Change only those repos. ${stepReadLine}

## How you work

- Read and search with the Read and Grep tools. Give Bash one command per call, run from the workspace root: no \`cd\`, no \`;\` or \`&&\` chains, no variables.
- In each conflicting repo, merge \`master\` into the ticket's branch, resolve every conflict keeping both sides' intent, and commit the merge on the ticket's branch.
- Run \`npm run check\` until it passes, committing any fix. Never amend, push, rebase or reset, never comment on or close an issue, and never run the wrap-up.

## When you're done

Return \`summary\`, one or two sentences on what conflicted and how you resolved it, and \`files\`, each file that conflicted as \`<repo> <path>\`.

## The conflict

${conflict}`;
}

export interface MergeMasterRecord {
  summary: string;
  files: string[];
}

export const mergeMasterOutputSchema = objectSchema({
  summary: stringSchema,
  files: arraySchema(stringSchema, { minItems: 1 }),
});
