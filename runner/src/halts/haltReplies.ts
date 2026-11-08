// Halt replies: which of the developer's spec-issue replies answer a Halt, `stop spec`, and what a Failure Halt's answer asks for.
// The Halt itself, its comment and the resume prompt are ../halts.ts; ../SpecRun/TicketSelector.ts reads the replies each pick.

import type { Pair } from "../AgentStep.ts";
import {
  type AnsweredHalt,
  type Halt,
  haltHeadingOf,
  isRunnersComment,
} from "../halts.ts";
import { pairNamed } from "../modelFit.ts";
import type { IssueComment } from "../SpecRun.ts";

export type FailureAnswer =
  | { kind: "retry" }
  | { kind: "retry-record" }
  | { kind: "more-turns"; turns: number | undefined }
  | { kind: "more-handoffs" }
  | { kind: "rerun"; pair: Pair }
  | { kind: "approve" }
  | { kind: "skip" }
  | { kind: "guidance"; text: string };

// `stop spec` ends the run that reads it, so a later run delivers it as `retry`; any other unnamed reply is guidance.
export function failureAnswerOf(halt: AnsweredHalt): FailureAnswer {
  if (isStopSpecAnswer(halt)) return { kind: "retry" };
  const text = answerTextOf(halt);
  const answerWords = wordsOf(text);
  if (answerWords === "retry") return { kind: "retry" };
  if (answerWords === "retry record") return { kind: "retry-record" };
  if (answerWords === "approve") return { kind: "approve" };
  if (answerWords === "skip") return { kind: "skip" };
  if (answerWords === "continue +1 handoff") return { kind: "more-handoffs" };
  const moreTurns = /^resume \+(\d+)? ?turns?$/.exec(answerWords);
  if (moreTurns !== null) {
    const [, turns] = moreTurns;
    return {
      kind: "more-turns",
      turns: turns === undefined ? undefined : Number(turns),
    };
  }
  const pair = pairNamed(/^rerun on (.+)$/.exec(answerWords)?.[1] ?? "");
  if (pair !== undefined) return { kind: "rerun", pair };
  return { kind: "guidance", text };
}

function wordsOf(text: string): string {
  return text
    .replace(/[`*:.,!]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

export interface ReplySearch {
  halt: Halt;
  // The spec issue's comments, oldest first.
  comments: IssueComment[];
  developer: string;
}

// The developer's replies opening with the Halt's id since it was last posted, oldest first; never the runner's own comments.
export function repliesTo({
  halt,
  comments,
  developer,
}: ReplySearch): IssueComment[] {
  const postedAt = comments.findLastIndex(
    (comment) =>
      isRunnersComment(comment) && comment.body.includes(haltHeadingOf(halt)),
  );
  if (postedAt === -1) return [];
  const opening = openingIdPatternOf(halt);
  return comments
    .slice(postedAt + 1)
    .filter(
      (comment) =>
        comment.author === developer &&
        !isRunnersComment(comment) &&
        opening.test(comment.body),
    );
}

// An id later in a reply is a mention, as in `H8: Same as H7`; Markdown emphasis around the opening one still counts.
function openingIdPatternOf({ id }: Halt): RegExp {
  return new RegExp(`^\\s*[*_\`]*${id}(?!\\w)[*_\`]*\\s*:?`);
}

function answerTextOf(halt: AnsweredHalt): string {
  return halt.answer.text.replace(openingIdPatternOf(halt), "").trim();
}

// Only an answer that opens with `stop spec`, so `retry, don't stop spec` is not one.
export function isStopSpecAnswer(halt: AnsweredHalt): boolean {
  return /^stop spec\b/.test(wordsOf(answerTextOf(halt)));
}
