// The red-checks step: the prompt that hands a ticket's failing checks back to whoever made its last commit, and the
// summary it returns. SpecRun.ts runs it once after red checks, resuming the implementer or the triage agent; still red is a Failure Halt.

import { stepReadLine } from "./IssueReader.ts";
import type { IssueRef } from "./IssueWorkspaces.ts";
import { objectSchema, stringSchema } from "./recordSchema.ts";

export interface RedChecksPromptInput {
  issue: IssueRef;
  title: string;
  branch: string;
  branchedRepos: string[];
  // Each failing check's command and the last lines of its output.
  failures: string;
}

export function redChecksPrompt({
  issue,
  title,
  branch,
  branchedRepos,
  failures,
}: RedChecksPromptInput): string {
  return `You are the red-checks step of an unattended run. Nobody is watching this session: never ask a question or wait for an answer.

The runner's checks failed on ${issue.repo}#${issue.number}, "${title}", after its last commit. Turn them green. Your working directory is the ticket's issue workspace root; these repos are on the ticket's branch, \`${branch}\`: ${branchedRepos.join(", ")}. Change only those repos. ${stepReadLine}

## How you work

- Read and search with the Read and Grep tools. Give Bash one command per call, run from the workspace root: no \`cd\`, no \`;\` or \`&&\` chains, no variables.
- Fix the cause, never the check: don't skip, delete or loosen a test or a lint rule to get past it.
- Commit the fix in each repo you changed, on the ticket's branch, then run \`npm run check\` until it passes. Never amend, push, merge, rebase or reset, never comment on or close an issue, and never run the wrap-up.

## When you're done

Return \`summary\`: one or two sentences on what was red and what you changed.

## The failing checks

${failures}`;
}

export const redChecksOutputSchema = objectSchema({ summary: stringSchema });
