// Resolve: the prompt that gives each review finding one verdict and fixes the Fix ones.
// reviewStep.ts supplies the findings; ../../resolveRecords.ts holds the record it returns and the checks on it.

import { stepReadLine } from "../../IssueReader.ts";
import {
  commitMessageLine,
  stepWriteLine,
  unattendedRunLine,
} from "../../promptText.ts";
import { implementBody } from "../../stepPrompts/implementText.ts";
import { resolveBody } from "../../stepPrompts/resolveText.ts";
import type { ResolvePromptInput } from "../../Workflow.ts";

export function resolvePrompt(input: ResolvePromptInput): string {
  const { branch, branchedRepos, findings } = input;
  return `You are the resolve step of an unattended run. ${unattendedRunLine()}

${resolveBody.findingsOf(input)} Your working directory is the ticket's issue workspace root; these repos are on the ticket's branch, \`${branch}\`: ${branchedRepos.join(", ")}. Change only those repos. Verify each finding against the code, the ticket and its spec before you judge it. ${stepReadLine}

## How you work

- ${implementBody.oneCommand}
- ${stepWriteLine}
- ${commitMessageLine}
- Fixes go on the ticket's branch, separate from the implement commit. ${resolveBody.commitNothing}
- Once the fixes are in, run \`npm run check\`. When it fails on a fix, fix it in a further commit and run it again. A fix you can't turn green, or one that would reverse a spec decision, ${resolveBody.revertedAs} When it fails only on something your fixes didn't cause, return your records anyway; the runner's checks step stops on it.
- When two fixes are equally good, pick one and say which in the commit message.
- ${resolveBody.onlyWrites}

${resolveBody.recordAndFindingsOf(findings)}`;
}
