// Halt replies: which of the developer's spec-issue replies answer a Halt, `stop spec`, and what a Failure Halt's answer asks for.
// The Halt itself, its comment and the resume prompt are ../halts.ts; ../SpecRun/TicketSelector.ts reads the replies each pick.

import type { Pair } from "../AgentStep.ts";
import {
  type Halt,
  type HaltAnswer,
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
export function failureAnswerOf(halt: Halt, answer: HaltAnswer): FailureAnswer {
  if (isStopSpecAnswer(answer)) return { kind: "retry" };
  const { text } = answer;
  const answerWords = text
    .replace(haltIdPatternOf(halt, "g"), " ")
    .replace(/[`*:.,!]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
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

export interface ReplySearch {
  halt: Halt;
  // The spec issue's comments, oldest first.
  comments: IssueComment[];
  developer: string;
}

// The developer's replies naming the Halt since it was last posted, oldest first; never the runner's own comments.
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
  const naming = haltIdPatternOf(halt);
  return comments
    .slice(postedAt + 1)
    .filter(
      (comment) =>
        comment.author === developer &&
        !isRunnersComment(comment) &&
        naming.test(comment.body),
    );
}

function haltIdPatternOf({ id }: Halt, flags = ""): RegExp {
  return new RegExp(`(^|[^\\w])${id}(?!\\w)`, flags);
}

export function isStopSpecAnswer({ text }: HaltAnswer): boolean {
  return /\bstop spec\b/i.test(text);
}
