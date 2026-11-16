// The review step: the prompt that runs a code review of a ticket's branch on both axes, by the implementer in a run or
// an interactive session from its brief, with the review skill's SKILL.md body inlined and its fixed point pinned; the
// review record it returns, and the check that it spawned its two reviewer subagents, with the resume that sends back
// one that didn't.
// codeWorkflow.ts supplies it, reading the skill from the workspace; SpecRun/ReviewStepper.ts launches it after the
// implement step, and SpecRun/SessionReviewer.ts prints it as a session's brief; resolve reads its findings.

import { posix } from "node:path";

import { stepReadLine } from "../../IssueReader.ts";
import {
  reviewerResumePromptOf,
  reviewFindingsText,
  reviewFramingOf,
} from "../../promptText.ts";
import { reviewRecordSchemaOf } from "../../recordSchema.ts";
import type { Axis } from "../../verdicts.ts";
import type {
  RepoCommits,
  ReviewerCheck,
  ReviewPromptInput,
} from "../../Workflow.ts";

const codeAxes: Axis[] = ["standards", "spec"];

// The review skill's SKILL.md as the ticket's issue workspace holds it, frontmatter and all.
export interface CodeReviewPromptInput extends ReviewPromptInput {
  skillText: string;
}

export function reviewPrompt({
  issue,
  title,
  skillName,
  skillText,
  branch,
  branchedRepos,
  isInlineAllowed,
  sessionSubmit,
  pointsWorthChecking = [],
  commitsSinceMaster,
}: CodeReviewPromptInput): string {
  const framing = reviewFramingOf(sessionSubmit);
  return [
    framing.opening,
    `Review ${issue.repo}#${issue.number}, "${title}", on both axes, with \`master\` as the fixed point, by the \`${skillName}\` skill below. Your working directory is the ticket's issue workspace root; these repos are on the ticket's branch, \`${branch}\`: ${branchedRepos.join(", ")}. Review each one's changes. ${stepReadLine}`,
    ...(commitsSinceMaster === undefined
      ? []
      : [fixedPointSectionOf(commitsSinceMaster)]),
    ...(isInlineAllowed ? [inlineLine] : []),
    ...pointsSectionsOf(pointsWorthChecking),
    `<skill name="${skillName}">\n${inlinedSkillOf(skillText, skillName)}\n</skill>`,
    `${framing.returnLineOf(["findings"])} ${reviewFindingsText({ axes: codeAxes, where: "its file:line or area", claim: "what it says, in a line" })}`,
  ].join("\n\n");
}

// The skill's step 1, done by the runner so the review spends no turns on it.
function fixedPointSectionOf(commitsSinceMaster: RepoCommits[]): string {
  const repoLines = commitsSinceMaster.map(({ repo, commits }) => {
    if (commits.length === 0) return `- \`${repo}\`: none`;
    return `- \`${repo}\`:\n${commits.map((commit) => `  - ${commit}`).join("\n")}`;
  });
  return `The fixed point is \`master\`: it resolves and the diff is non-empty, so the skill's step 1 is done. Each repo's diff is \`git diff master...HEAD\` in its clone; its commits since \`master\`:\n\n${repoLines.join("\n")}`;
}

// The session works from the workspace root, not the skill's folder, so each relative link is made the root's.
function inlinedSkillOf(skillText: string, skillName: string): string {
  const skillFolder = `.claude/skills/${skillName}`;
  return bodyOf(skillText).replace(
    /\]\(([^)\s]+)\)/g,
    (link, target: string) => {
      if (/^([a-z][a-z0-9+.-]*:|#|\/)/i.test(target)) return link;
      return `](${posix.normalize(posix.join(skillFolder, target))})`;
    },
  );
}

function bodyOf(skillText: string): string {
  const frontmatter = /^---\n[\s\S]*?\n---\n/.exec(skillText);
  const body =
    frontmatter === null ? skillText : skillText.slice(frontmatter[0].length);
  return body.trim();
}

// Empty when the implementer named none, as for a session's brief, which has no implement record.
function pointsSectionsOf(points: string[]): string[] {
  if (points.length === 0) return [];
  return [
    `## The implementer's points worth checking\n\n${points.map((point) => `- ${point}`).join("\n")}`,
    "These are where the implementer suspects its work is weak, unfinished or easy to get wrong. When you brief the reviewers, paste it into both reviewers' briefs, Standards and Spec alike, as things to check, not as findings: each reviewer reports only what it confirms.",
  ];
}

// A diff this small doesn't need two reviewers, so the step may review on both axes itself.
const inlineLine =
  "The diff is small enough that you may review it inline: you may work through both axes yourself rather than spawn the reviewer subagents.";

// The Standards and Spec reviewers `/code-review` spawns; a review over the inline size that spawns fewer is sent back once.
export function reviewerCheckOf(skillName: string): ReviewerCheck {
  return {
    count: codeAxes.length,
    resumePrompt: reviewerResumePromptOf(
      `both, the Standards and Spec reviewers, as the "${skillName}" skill says: two Agent calls in one message`,
    ),
    offerInline: true,
  };
}

export const reviewRecordSchema = reviewRecordSchemaOf(codeAxes);
