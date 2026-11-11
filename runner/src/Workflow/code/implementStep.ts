// The implement step: the prompt the runner sends, a non-interactive fork of upstream `implement`
// recorded in byro-repo's .claude/skills/upstream.json, and the implement record it returns.
// AgentStep.ts launches the step; StepStream.ts checks the output against implementOutputSchema.
// Its record parts, handoff text and status check are every Workflow's, in ../../recordSchema.ts,
// ../../stepPrompts/handoffText.ts and ../../stepRecords.ts.

import { gitHubWriteActions } from "../../FactsFile.ts";
import { stepReadLine } from "../../IssueReader.ts";
import {
  commitMessageLine,
  sectionOf,
  stepWriteLine,
  unattendedRunLine,
} from "../../promptText.ts";
import {
  arraySchema,
  branchSchema,
  implementVariantSchema,
  objectSchema,
  stringSchema,
  uncommittedVariantSchemas,
} from "../../recordSchema.ts";
import { handoffText } from "../../stepPrompts/handoffText.ts";
import {
  implementBody,
  implementWorkspaceSection,
  ticketBindsSection,
} from "../../stepPrompts/implementText.ts";
import type { ImplementPromptInput } from "../../Workflow.ts";

export function implementPrompt(input: ImplementPromptInput): string {
  const { issue, title, body, latestHandoff } = input;
  return [
    `You are the implement step of an unattended run. Implement ${issue.repo}#${issue.number}, "${title}". ${unattendedRunLine()}`,
    implementWorkspaceSection(input),
    gitHubSection(),
    workingSection(),
    ticketBindsSection(),
    promptSections.finishing,
    promptSections.handoff,
    ...(latestHandoff ? [handoffText.previousSectionOf(latestHandoff)] : []),
    `## The ticket\n\n${body}`,
  ].join("\n\n");
}

function gitHubSection(): string {
  return sectionOf("GitHub", [
    implementBody.gitHubWrites,
    `${stepReadLine} When you need a field the reader doesn't print, record a \`denied-tool\` blocker naming it.`,
  ]);
}

function workingSection(): string {
  return sectionOf("How you work", [
    implementBody.testFirst,
    `${implementBody.checking} At the end, commit, then run \`npm run check\` once; it must pass before you return a \`committed\` record.`,
    implementBody.oneCommand,
    stepWriteLine,
    commitMessageLine,
    "Never ask. When the ticket is ambiguous, a command needs a yes nobody gave, or a tool is denied, don't stall: record it as a blocker (`spec-ambiguity`, `gated-action` or `denied-tool`) with what happened and what you recommend the developer do. Carry on with the reading the ticket best supports when the work can go on without it; otherwise stop with status `blocked`.",
  ]);
}

const promptSections = {
  finishing: `## When you're done

- ${implementBody.drift}
- ${implementBody.committing} When it fails only on something your change didn't cause, return your record anyway and name the failure in \`boxesUndone\`; the runner's checks step stops on it.
- ${implementBody.onlyWrites}, and never run the wrap-up. Don't call code review; the runner reviews after you.
- When review findings come back to you: ${implementBody.resolving}
- Then stop and return the implement record as \`record\`:
  - \`status\`: \`committed\`; \`applied\` when the ticket needed only GitHub writes and you committed nothing; or \`blocked\` when a blocker stopped you before any commit.
  - \`branches\`: each repo you committed in, its branch and its last commit's sha, in landing order (a repo lands before any repo that depends on it; a package clone before the root). Empty unless committed.
  - \`githubWrites\`: only when applied, each GitHub write you made: its issue as \`owner/repo#n\`, its action (\`edit\` or \`comment\`), its URL and a one-line summary.
  - \`closingComment\`: what landed, for the ticket's closing comment.
  - \`boxesUndone\`: each acceptance box you left undone, with why.
  - \`blockers\`: each blocker, as above.`,

  handoff: handoffText.nudgeSectionOf({
    inHand: "step",
    filesToOpen: "path and line range",
    stillFailing: "empty when the code is green",
    splitWhen: "the ticket is done",
    slices:
      "the remaining work as slices, each with what it `delivers` and the `files` it changes",
  }),
} as const;

const gitHubWriteSchema = objectSchema({
  issue: stringSchema,
  action: { enum: gitHubWriteActions },
  url: stringSchema,
  summary: stringSchema,
});

// One variant per status, so only the status that needs a field carries it.
const recordVariantsSchema = {
  oneOf: [
    implementVariantSchema("committed", {
      branches: arraySchema(branchSchema, { minItems: 1 }),
    }),
    implementVariantSchema("applied", {
      branches: arraySchema(branchSchema, { maxItems: 0 }),
      githubWrites: arraySchema(gitHubWriteSchema, { minItems: 1 }),
    }),
    uncommittedVariantSchemas.blocked,
    uncommittedVariantSchemas.handoff,
  ],
};

// The API refuses a top-level oneOf in a tool's input schema, so the record sits under `record`.
export const implementOutputSchema = objectSchema({
  record: recordVariantsSchema,
});
