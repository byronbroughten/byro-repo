// The piece review step: the prompt that runs a review of a drafting ticket's Agent draft on the spec, standards and
// reader axes, by the implementer in a run or an interactive session from its brief, with `/review-piece`'s SKILL.md
// body inlined and the files reviewInputs.ts wrote named before it, the review record it returns: code's, on these
// axes, plus the overlap hits it judged no copy, and the check that it spawned its three reviewer subagents, with the
// resume that sends back one that didn't.
// pieceWorkflow.ts registers it, reading the skill from the workspace through ../../stepPrompts/inlinedSkill.ts;
// ../../SpecRun/ReviewStepper.ts launches it and ../../SpecRun/SessionReviewer.ts prints it.

import { stepReadLine } from "../../IssueReader.ts";
import {
  codeListOf,
  heldTicketLinesOf,
  reviewerResumePromptOf,
  reviewFindingsText,
  reviewFramingOf,
} from "../../promptText.ts";
import {
  arraySchema,
  objectSchema,
  reviewRecordSchemaOf,
  stringSchema,
} from "../../recordSchema.ts";
import { inlinedSkill } from "../../stepPrompts/inlinedSkill.ts";
import type { Axis } from "../../verdicts.ts";
import type {
  ReviewerCheck,
  ReviewPromptInput,
  SuppliedInput,
} from "../../Workflow.ts";
import { draftingScope } from "./draftingScope.ts";
import { passagesFolderIn } from "./implementStep.ts";

const pieceAxes: Axis[] = ["spec", "standards", "reader"];

export interface PieceReviewPromptInput extends ReviewPromptInput {
  draftPath: string;
  // `/review-piece`'s SKILL.md as the ticket's issue workspace holds it, frontmatter and all.
  skillText: string;
}

export function pieceReviewPrompt({
  issue,
  spec,
  title,
  labels,
  skillName,
  skillText,
  branch,
  workspacePath,
  draftPath,
  sessionSubmit,
  isTicketHeld,
  suppliedInputs = [],
}: PieceReviewPromptInput): string {
  const passagesFolder = passagesFolderIn(workspacePath, issue);
  const scope = draftingScope.sectionsOf(labels);
  const framing = reviewFramingOf(
    sessionSubmit,
    " on a piece spec's drafting ticket",
  );
  const heldTicket = heldTicketLinesOf(isTicketHeld).map(
    (line) => `${line}\n\n`,
  );
  return `${framing.opening}

Review ${issue.repo}#${issue.number}, "${title}", on the ${codeListOf(pieceAxes, "and")} axes, by the \`${skillName}\` skill below. Your working directory is the ticket's issue workspace root, on the ticket's branch, \`${branch}\`. The draft input is the Agent draft, \`${draftPath}\` in the \`${spec.repo}\` clone, and the passages folder, \`${passagesFolder}\`; the ticket's spec is ${spec.repo}#${spec.number}. The in-scope text is ${scope}. ${stepReadLine}

${heldTicket.join("")}${suppliedInputsLinesOf(suppliedInputs, skillName)}${inlinedSkill.sectionOf(skillText, skillName)}

${framing.returnLineOf(["findings", "dismissedOverlaps"])}
- ${reviewFindingsText({ axes: pieceAxes, where: "its file:line in the Agent draft, or the spec's Outline line for a reader finding", claim: "what it says, in a line, quoting the sentence" })}
- \`dismissedOverlaps\`: each overlap hit the spec reviewer judged no copy, its \`hit\` as the overlap command printed it and its one-line \`reason\`; empty when it dismissed none.`;
}

// A paragraph before the skill, empty when its caller supplies nothing, so an unsupplied input is gathered as the skill says.
function suppliedInputsLinesOf(
  suppliedInputs: SuppliedInput[],
  skillName: string,
): string {
  if (suppliedInputs.length === 0) return "";
  const written = suppliedInputs.flatMap((input) =>
    "path" in input ? [`the ${input.name} file, \`${input.path}\``] : [],
  );
  const absent = suppliedInputs.flatMap((input) =>
    "absence" in input ? [`No ${input.name} file: ${input.absence}.`] : [],
  );
  const lines = [
    `The runner has written the inputs \`${skillName}\` skill copies word for word; use each as given and gather only the rest, the fact list included: ${written.join("; ")}.`,
    ...allowLinesOf(suppliedInputs),
    ...absent,
  ];
  return `${lines.join(" ")}\n\n`;
}

// The runner can't judge which names the Piece can't reword, so its allow file lists none, as pieceChecks' overlap run.
function allowLinesOf(suppliedInputs: SuppliedInput[]): string[] {
  if (!suppliedInputs.some(({ name }) => name === "Overlap allow")) return [];
  return [
    "The Overlap allow file lists no terms, so the spec reviewer judges overlap hits on proper names and fixed terms as Dismissed overlaps.",
  ];
}

// The spec, standards and reader reviewers `/review-piece` spawns. Its diff is the Agent draft alone, so the file count
// would always offer inline review; in the drafter's own session a skipped spawn leaves the drafter checking its own prose.
export function pieceReviewerCheckOf(skillName: string): ReviewerCheck {
  return {
    count: pieceAxes.length,
    resumePrompt: reviewerResumePromptOf(
      `all three, the spec, standards and reader reviewers, as the "${skillName}" skill says: three Agent calls in one message`,
    ),
    offerInline: false,
  };
}

export const pieceReviewRecordSchema = reviewRecordSchemaOf(pieceAxes, {
  dismissedOverlaps: arraySchema(
    objectSchema({ hit: stringSchema, reason: stringSchema }),
  ),
});
