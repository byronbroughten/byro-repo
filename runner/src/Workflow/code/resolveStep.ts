// Resolve: the prompt that gives each review finding one verdict and fixes the Fix ones.
// reviewStep.ts supplies the findings; ../../resolveRecords.ts holds the record it returns and the checks on it.

import { stepReadLine } from "../../IssueReader.ts";
import { commitMessageLine, stepWriteLine } from "../../promptText.ts";
import { numberedFindingsOf } from "../../resolveRecords.ts";
import { resolveRecordFields, resolveRules } from "../../stepPrompts.ts";
import type { ResolvePromptInput } from "../../Workflow.ts";

export function resolvePrompt({
  issue,
  title,
  branch,
  branchedRepos,
  findings,
}: ResolvePromptInput): string {
  return `You are the resolve step of an unattended run. Nobody is watching this session: never ask a question or wait for an answer.

The review of ${issue.repo}#${issue.number}, "${title}", reported the findings below, each with its axis and its reviewer's suggested verdict. ${resolveRules} Your working directory is the ticket's issue workspace root; these repos are on the ticket's branch, \`${branch}\`: ${branchedRepos.join(", ")}. Change only those repos. Verify each finding against the code, the ticket and its spec before you judge it. ${stepReadLine}

## How you work

- Read and search with the Read and Grep tools. Give Bash one command per call, run from the workspace root: no \`cd\`, no \`;\` or \`&&\` chains, no variables.
- ${stepWriteLine}
- ${commitMessageLine}
- Fixes go on the ticket's branch, separate from the implement commit. Commit nothing when no finding is a Fix.
- Once the fixes are in, run \`npm run check\`. When it fails on a fix, fix it in a further commit and run it again. A fix you can't turn green, or one that would reverse a spec decision, is reverted in a further commit and resolved, saying why, as a Propose \`decision\`, or for a \`spec\`-axis finding as a Halt scoped to the downstream tickets. When it fails only on something your fixes didn't cause, return your records anyway; the runner's checks step stops on it.
- When two fixes are equally good, pick one and say which in the commit message.
- Never amend, push, merge, rebase or reset, never comment on, file or close an issue, and never run the wrap-up. The runner acts on your Propose and Halt verdicts.

## The record

Return \`records\`, ${resolveRecordFields}

## Findings

${numberedFindingsOf(findings)}`;
}
