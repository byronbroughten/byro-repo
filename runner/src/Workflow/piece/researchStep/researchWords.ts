// The research step's words: the prompt the runner sends a piece spec's research ticket, which carries /research-piece's and
// /review-research's bodies inline and follows the first up to its post, the scratch folder it names, the section a retry gets on what
// the first try left, the section a step sent back on red quotes gets, the handoff comment, the closing comment the ticket lands with, and the words of its Research Halt.
// researchRecord.ts holds the record it returns and the checks on it; ../pieceWorkflow.ts registers both as the piece Workflow's research rules.

import { join } from "node:path";

import type { HaltQuestion } from "../../../halts.ts";
import { stepReadLine } from "../../../IssueReader.ts";
import type { IssueRef } from "../../../IssueWorkspaces.ts";
// Renamed, since a ready record's own field is `outlineEdits`.
import { outlineEdits as outlineEditWords } from "../../../outlineEdits.ts";
import {
  bulletsOf,
  stepOpeningOf,
  unattendedRunLine,
} from "../../../promptText.ts";
import { inlinedSkill } from "../../../stepPrompts/inlinedSkill.ts";
import type {
  ReadyResearchRecord,
  ResearchHandoff,
  UnverifiedItem,
} from "../../../stepRecords.ts";
import type {
  FirstTry,
  RedQuotes,
  ResearchPromptInput,
} from "../../../Workflow.ts";

// The spec's one send-back on red quotes before a Failure Halt; the prompt's count and the runner's limit both read it.
export const quoteSendBacks = 1;

// ../pieceWorkflow.ts reads each from the workspace by the same name the prompt calls it.
export const researchSkillNames = {
  research: "research-piece",
  review: "review-research",
} as const;

// The skills' SKILL.md texts, read from the issue workspace by ../pieceWorkflow.ts.
export interface ResearchSkillPromptInput extends ResearchPromptInput {
  researchSkillText: string;
  reviewSkillText: string;
}

// Gitignored at the workspace root, so a retry finds what the try before it left.
export function researchScratchFolderOf({ repo, number }: IssueRef): string {
  return `.runner/research/${repo}-${number}`;
}

export function researchPrompt(input: ResearchSkillPromptInput): string {
  const {
    issue,
    title,
    body,
    workspacePath,
    latestHandoff,
    redQuotes,
    firstTry,
  } = input;
  const scratchFolder = join(workspacePath, researchScratchFolderOf(issue));
  return [
    `${stepOpeningOf("research step")} Research ${issue.repo}#${issue.number}, "${title}". ${unattendedRunLine()}`,
    stepsSection(scratchFolder),
    `## GitHub\n\n- Make no GitHub write: the runner posts your comment once its quote check passes, and you post nothing.\n- ${stepReadLine}`,
    promptSections.record,
    promptSections.handoff,
    ...(firstTry ? [firstTrySection(scratchFolder, firstTry)] : []),
    ...(latestHandoff ? [previousHandoffSection(latestHandoff)] : []),
    ...(redQuotes ? [redQuotesSection(redQuotes)] : []),
    inlinedSkill.sectionOf(
      input.researchSkillText,
      researchSkillNames.research,
    ),
    inlinedSkill.sectionOf(input.reviewSkillText, researchSkillNames.review),
    `## The ticket\n\n${body}`,
  ].join("\n\n");
}

function stepsSection(scratchFolder: string): string {
  return `## What you do

- Follow the \`${researchSkillNames.research}\` skill below's first seven steps, acting on the verdicts included, with its step 5 pass done by the \`${researchSkillNames.review}\` skill below. Both are here in full: never read either by path or call it. Stop after step 7: post nothing and delete nothing.
- Your scratch folder is \`${scratchFolder}\`: use it as the skill's scratchpad, and leave it in place, since the runner reads the comment and texts from it.
${promptSections.stepRules}`;
}

const promptSections = {
  stepRules: `- Propose each Outline edit the research calls for in the record; never apply one.
- In \`## Unverified\`, mark an item wanted when the ticket's \`## Facts\` field names its fact.
- Never ask. When the ticket is ambiguous, a source can't be read or a tool is denied, record it as a blocker (\`spec-ambiguity\`, \`gated-action\` or \`denied-tool\`) with what happened and what you recommend the developer do. Carry on when the research can go on without it; otherwise stop with status \`blocked\`.`,

  record: `## When you're done

Return the research record as \`record\`:

- \`status\`: \`ready\` once step 7's quote check exits 0; \`blocked\` when a blocker stopped you first.
- \`commentPath\` and \`textsFolder\`: the absolute paths of \`comment.md\` and the texts folder in your scratch folder.
- \`counts\`: the facts the review left \`supported\`, the ones you \`rewritten\`, and the ones moved to \`## Unverified\` as \`unverified\`.
- \`outlineEdits\`: each Outline edit you propose, with its \`section\` (the Section's full heading path), the \`oldText\` it replaces, quoted exactly from the spec's \`## Outline\`, its \`newText\` and its \`reason\`. An approved edit replaces that text word for word.
- \`unverified\`: each \`## Unverified\` item, its \`fact\`, its \`reason\` and \`isWanted\`.
- \`blockers\`: each blocker, as above.`,

  handoff: `## If a context nudge fires

Finish the source in hand, then stop: post nothing and return status \`handoff\` with every \`handoff\` field: \`conclusion\`, \`sourcesDone\` and \`sourcesLeft\`. A handoff is cumulative: carry over whatever still matters from any handoff you started from.`,
} as const;

// The first try may have crashed or hit its turn cap with no record, so the folder, not a record, says what it left.
function firstTrySection(scratchFolder: string, { files }: FirstTry): string {
  const commentPath = join(scratchFolder, "comment.md");
  const fileLines =
    files.length === 0
      ? "It left no files there."
      : `Its scratch folder holds:${bulletsOf(files.map((file) => `\`${file}\``))}`;
  const commentLine = files.includes("comment.md")
    ? `Its comment is \`${commentPath}\`; build on it.`
    : "It left no comment.";
  return `## The first try

The research step ran on this ticket before, and the developer answered its Failure Halt with \`retry\`. It worked in the scratch folder above, \`${scratchFolder}\`.

${fileLines}

${commentLine} Build on what it left rather than starting over.`;
}

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
      "The research left these to settle before any drafting starts. Settle every item you answer here in one reply: the first reply answers the whole Halt.",
      ...groups.map(({ heading, lines }) => `${heading}:${bulletsOf(lines)}`),
    ].join("\n\n"),
    options: groups.flatMap(({ options }) => options),
  };
}

const researchHaltOptions = {
  facts: [
    "`drop F<n>`: clear the fact and go on without it.",
    "`another source F<n>`, naming the source: tell the Supervisor in its session, not in a reply here. With one fact from one Drive file, the Supervisor settles your other answers with you, reads the fact, posts it as an addendum on the Research ticket, then answers this Halt. For anything larger, file a Research ticket with `/project-tickets`, blocking the drafting tickets, before answering.",
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
