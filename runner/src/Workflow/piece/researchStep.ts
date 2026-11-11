// The research step: the prompt the runner sends a piece spec's research ticket, which follows /research-piece up to
// its post, and the research record it returns, with the checks the runner makes on it before ../../SpecRun/ResearchStepper.ts keeps it,
// the section a step sent back on red quotes gets, the closing comment the ticket lands with, and the words of its Research Halt.
// pieceWorkflow.ts registers these as the piece Workflow's research rules.

import { existsSync } from "node:fs";
import { resolve } from "node:path";

import type { HaltQuestion } from "../../halts.ts";
import { stepReadLine } from "../../IssueReader.ts";
// Renamed, since a ready record's own field is `outlineEdits`.
import {
  outlineEdits as outlineEditWords,
  outlineEditSchema,
} from "../../outlineEdits.ts";
import { bulletsOf } from "../../promptText.ts";
import {
  arraySchema,
  blockerSchema,
  objectSchema,
  schemaProblemsOf,
  stringSchema,
} from "../../recordSchema.ts";
import type {
  ReadyResearchRecord,
  ResearchHandoff,
  ResearchRecord,
  UnverifiedItem,
} from "../../stepRecords.ts";
import type { RedQuotes, ResearchPromptInput } from "../../Workflow.ts";

const skillPath = ".claude/skills/research-piece/SKILL.md";

// The spec's one send-back on red quotes before a Failure Halt; the prompt's count and the runner's limit both read it.
export const quoteSendBacks = 1;

export function researchPrompt(input: ResearchPromptInput): string {
  const { issue, title, body, latestHandoff, redQuotes } = input;
  return [
    `You are the research step of an unattended run. Research ${issue.repo}#${issue.number}, "${title}". Nobody is watching this session: never ask a question or wait for an answer.`,
    promptSections.steps,
    `## GitHub\n\n- Make no GitHub write: the runner posts your comment once its quote check passes, and you post nothing.\n- ${stepReadLine}`,
    promptSections.record,
    promptSections.handoff,
    ...(latestHandoff ? [previousHandoffSection(latestHandoff)] : []),
    ...(redQuotes ? [redQuotesSection(redQuotes)] : []),
    `## The ticket\n\n${body}`,
  ].join("\n\n");
}

const promptSections = {
  steps: `## What you do

- Read \`${skillPath}\` and follow its first seven steps, its \`/review-research\` pass and acting on the verdicts included. Stop after step 7: post nothing and delete nothing.
- Work in a scratch folder of your own under \`$TMPDIR\`, and leave it in place: the runner reads the comment and texts from it.
- Propose each Outline edit the research calls for in the record; never apply one.
- In \`## Unverified\`, mark an item wanted when the ticket's \`## Facts\` field names its fact.
- Never ask. When the ticket is ambiguous, a source can't be read or a tool is denied, record it as a blocker (\`spec-ambiguity\`, \`gated-action\` or \`denied-tool\`) with what happened and what you recommend the developer do. Carry on when the research can go on without it; otherwise stop with status \`blocked\`.`,

  record: `## When you're done

Return the research record as \`record\`:

- \`status\`: \`ready\` once step 7's quote check exits 0; \`blocked\` when a blocker stopped you first.
- \`commentPath\` and \`textsFolder\`: the absolute paths of \`comment.md\` and the texts folder in your scratch folder.
- \`counts\`: the facts the review left \`supported\`, the ones you \`rewritten\`, and the ones moved to \`## Unverified\` as \`unverified\`.
- \`outlineEdits\`: each Outline edit you propose, with its \`section\`, the \`oldText\` it replaces, quoted exactly from the spec's \`## Outline\`, its \`newText\` and its \`reason\`. An approved edit replaces that text word for word.
- \`unverified\`: each \`## Unverified\` item, its \`fact\`, its \`reason\` and \`isWanted\`.
- \`blockers\`: each blocker, as above.`,

  handoff: `## If a context nudge fires

Finish the source in hand, then stop: post nothing and return status \`handoff\` with every \`handoff\` field: \`conclusion\`, \`sourcesDone\` and \`sourcesLeft\`. A handoff is cumulative: carry over whatever still matters from any handoff you started from.`,
} as const;

function previousHandoffSection(handoff: ResearchHandoff): string {
  return `## Handoff from the previous step

The previous step's scratch folder holds its work; build on it.

${handoffText(handoff)}`;
}

function redQuotesSection({
  record: { commentPath, textsFolder },
  failure,
}: RedQuotes): string {
  return `## The quote check failed

The runner reran step 7's quote check on the comment at \`${commentPath}\`, with the texts in \`${textsFolder}\`, and it failed:

\`\`\`
${failure}
\`\`\`

Build on that scratch folder rather than starting over: fix each failure by step 4's fixes, rerun the check until it exits 0, then return the record again. The runner sends the step back ${quoteSendBacks} time(s) at most; a red check after that halts the ticket.`;
}

// The ticket closes on it once the comment is posted.
export function researchClosingCommentOf({
  counts,
  outlineEdits,
  unverified,
}: ReadyResearchRecord): string {
  return [
    `Posted the research comment: ${counts.supported} fact(s) supported, ${counts.rewritten} rewritten and ${counts.unverified} unverified.`,
    `Proposed Outline edits:${bulletsOf(outlineEdits.map(outlineEditWords.textOf))}`,
    `Unverified facts the Facts field names:${bulletsOf(wantedOf(unverified).map(unverifiedTextOf))}`,
  ].join("\n\n");
}

export function researchHaltOf({
  outlineEdits,
  unverified,
}: ReadyResearchRecord): HaltQuestion | undefined {
  const groups = [
    {
      heading: "Wanted facts it couldn't verify",
      lines: wantedOf(unverified).map(
        (item, index) => `**F${index + 1}** ${unverifiedTextOf(item)}`,
      ),
      options: researchHaltOptions.facts,
    },
    {
      heading: "Proposed Outline edits",
      lines: outlineEdits.map(outlineEditWords.lineOf),
      options: researchHaltOptions.edits,
    },
  ].filter(({ lines }) => lines.length > 0);
  if (groups.length === 0) return undefined;
  return {
    question: [
      "The research left these to settle before any drafting starts. Settle every item in one reply: the first reply answers the whole Halt.",
      ...groups.map(({ heading, lines }) => `${heading}:${bulletsOf(lines)}`),
    ].join("\n\n"),
    options: groups.flatMap(({ options }) => options),
  };
}

const researchHaltOptions = {
  facts: [
    "`drop F<n>`: clear the fact and go on without it.",
    "`another source F<n>`, naming the source: the Supervisor settles one fact from one Drive file. For anything larger, file a Research ticket with `/piece-tickets`, blocking the drafting tickets, before answering.",
  ],
  edits: [
    "`approve E<n>`: the runner replaces the edit's old text in the spec's `## Outline` with its new text, word for word, as it reads the answer. An edit it can't apply raises a fresh Halt asking you to make the change by hand.",
  ],
} as const;

function wantedOf(unverified: UnverifiedItem[]): UnverifiedItem[] {
  return unverified.filter(({ isWanted }) => isWanted);
}

function unverifiedTextOf({ fact, reason }: UnverifiedItem): string {
  return `${fact} (${reason})`;
}

// The runner posts it on the ticket; the `session:` line ties it to the step's transcript.
export function researchHandoffCommentOf(
  handoff: ResearchHandoff,
  sessionId: string,
): string {
  return [
    "## Handoff",
    "The research step handed this ticket to a fresh research step.",
    handoffText(handoff),
    `session: ${sessionId}`,
  ].join("\n\n");
}

function handoffText({
  conclusion,
  sourcesDone,
  sourcesLeft,
}: ResearchHandoff): string {
  return [
    `Conclusion: ${conclusion}`,
    `Sources done:${bulletsOf(sourcesDone)}`,
    `Sources left:${bulletsOf(sourcesLeft)}`,
  ].join("\n");
}

const countSchema = { type: "integer", minimum: 0 };

// One variant per status, so only the status that needs a field carries it.
const recordVariantsSchema = {
  oneOf: [
    objectSchema({
      status: { const: "ready" },
      commentPath: stringSchema,
      textsFolder: stringSchema,
      counts: objectSchema({
        supported: countSchema,
        rewritten: countSchema,
        unverified: countSchema,
      }),
      outlineEdits: arraySchema(outlineEditSchema),
      unverified: arraySchema(
        objectSchema({
          fact: stringSchema,
          reason: stringSchema,
          isWanted: { type: "boolean" },
        }),
      ),
      blockers: arraySchema(blockerSchema),
    }),
    objectSchema({
      status: { const: "blocked" },
      blockers: arraySchema(blockerSchema, { minItems: 1 }),
    }),
    objectSchema({
      status: { const: "handoff" },
      blockers: arraySchema(blockerSchema),
      handoff: objectSchema({
        conclusion: stringSchema,
        sourcesDone: arraySchema(stringSchema),
        sourcesLeft: arraySchema(stringSchema),
      }),
    }),
  ],
};

// The API refuses a top-level oneOf in a tool's input schema, so the record sits under `record`.
export const researchOutputSchema = objectSchema({
  record: recordVariantsSchema,
});

export function researchRecordOf(output: unknown): ResearchRecord {
  return (output as { record: ResearchRecord }).record;
}

// What the schema can't see: whether a ready record's comment is where it says.
export function researchRecordProblems(output: unknown, cwd: string): string[] {
  const problems = schemaProblemsOf(researchOutputSchema, output);
  if (problems.length > 0) return problems;
  const record = researchRecordOf(output);
  if (record.status !== "ready") return [];
  const commentPath = resolve(cwd, record.commentPath);
  if (existsSync(commentPath)) return [];
  return [`the record is ready, but the comment at ${commentPath} isn't there`];
}
