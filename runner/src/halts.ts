// Halts: the Halts a ticket's steps raise, the spec-issue comment and notice line each is posted as, how a developer's
// reply answers one, and the prompt that hands every answer back to the ticket's resumed or fresh implementer.
// SpecRun.ts keeps them in run state, blocks the tickets in their scope and resumes the halted ticket once all are answered.

import type { Pair } from "./AgentStep.ts";
import {
  type HaltScope,
  haltScopeOf,
  type TriageRecord,
} from "./findingTriage.ts";
import type { Blocker } from "./implementStep.ts";
import type { BodyAuthorship } from "./IssueReader.ts";
import { issueLabelOf, type IssueRef } from "./IssueWorkspaces.ts";
import { pairNamed } from "./modelFit.ts";
import type { IssueComment, TicketStep } from "./SpecRun.ts";

// Marks every comment the runner posts, which carries the developer's login too, so none is read as an answer.
export const runnerMark = "<!-- spec-runner -->";

const stopSpecOption = "`stop spec`";

const kindLabels = {
  verdict: "triage Halt",
  "give-up": "fixer give-up",
  "gated-action": "gated-action blocker",
  "spec-ambiguity": "spec-ambiguity blocker",
  "denied-tool": "denied-tool blocker",
  failure: "Failure Halt",
} as const;

export type HaltKind = keyof typeof kindLabels;

export interface Halt {
  // `H<n>`, numbered across the spec's run; a reply names it.
  id: string;
  // The halted ticket.
  ticket: IssueRef;
  kind: HaltKind;
  question: string;
  // The recommendations, without `stop spec`, which every Halt offers.
  options: string[];
  scope: HaltScope;
  // The triage finding it came from, if any.
  finding?: number;
  // A Failure Halt's step, which a `retry` answer runs again.
  failedStep?: FailedStep;
  // The authorship a launch-time check reported; answering the Halt approves just those edits.
  untrustedBody?: BodyAuthorship;
  isPosted: boolean;
  answer?: HaltAnswer;
  // Set once the answer reached the resumed or fresh implementer.
  isDelivered: boolean;
  // Replies already noted on the spec issue as ignored.
  ignoredReplies: string[];
}

export interface HaltAnswer {
  replyId: string;
  text: string;
  // When the runner read it; the oldest answered set resumes first.
  at: string;
}

// What a Halt needs before the run numbers it.
export type HaltDraft = Pick<
  Halt,
  | "kind"
  | "question"
  | "options"
  | "scope"
  | "finding"
  | "failedStep"
  | "untrustedBody"
>;

export function shortRefOf({ repo, number }: IssueRef): string {
  return `${repo}#${number}`;
}

export function haltKindLabelOf(kind: HaltKind): string {
  return kindLabels[kind];
}

// A blocker's Halt holds its own ticket and the tickets downstream of it.
export function blockerHaltOf(
  { kind, detail, recommendation }: Blocker,
  downstream: string[],
): HaltDraft {
  const options = [recommendation];
  if (kind === "denied-tool") {
    options.push("Add it to the ticket's `## Targets`, then resume");
  }
  return { kind, question: detail, options, scope: downstream };
}

// The fixer's give-ups arrive already rewritten as Halt records by giveUpRecordOf().
export function triageHaltOf(
  record: TriageRecord,
  kind: "verdict" | "give-up",
): HaltDraft {
  const { finding, claim, where, evidence, recommendation } = record;
  return {
    kind,
    question: `Finding ${finding}: ${claim} (${where}) ${evidence}`,
    options: [recommendation ?? ""],
    scope: haltScopeOf(record),
    finding,
  };
}

// The gap check fails outside any ticket, so its Failure Halt is raised on the spec issue.
export type FailedStep = TicketStep | "gap-check";

export interface StepFailure {
  step: FailedStep;
  detail: string;
  logPath: string;
  // The answers offered in place of `retry`.
  options?: string[];
  untrustedBody?: BodyAuthorship;
}

export const failureOptions = {
  retry: "`retry`",
  retryRecord: "`retry record`",
  skip: "`skip`",
} as const;

// Any answer but `stop spec` and `skip` runs the step again with a fresh count.
export function failureHaltOf(
  {
    step,
    detail,
    logPath,
    options = [failureOptions.retry],
    untrustedBody,
  }: StepFailure,
  downstream: string[],
): HaltDraft {
  return {
    kind: "failure",
    question: `${detail}\n\nLog: \`${logPath}\``,
    options,
    scope: downstream,
    failedStep: step,
    untrustedBody,
  };
}

export type FailureAnswer =
  | { kind: "retry" }
  | { kind: "retry-record" }
  | { kind: "more-turns"; turns: number | undefined }
  | { kind: "rerun"; pair: Pair }
  | { kind: "skip" }
  | { kind: "guidance"; text: string };

// `stop spec` is read apart by isStopSpecAnswer(); any other unnamed reply is guidance.
export function failureAnswerOf(
  halt: Halt,
  { text }: HaltAnswer,
): FailureAnswer {
  const answerWords = text
    .replace(haltIdPatternOf(halt, "g"), " ")
    .replace(/[`*:.,!]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
  if (answerWords === "retry") return { kind: "retry" };
  if (answerWords === "retry record") return { kind: "retry-record" };
  if (answerWords === "skip") return { kind: "skip" };
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

export function guidanceSectionOf(guidance: string): string {
  return `## The developer's guidance

This step failed before, and the developer answered its Failure Halt with the words below. Act on them.

${guidance}`;
}

export interface HaltPost {
  halt: Halt;
  // Its place among the Halts posted for its ticket at once, from 1.
  index: number;
  count: number;
  ticketTitle: string;
}

function haltLabelOf({ halt, index, count }: HaltPost): string {
  return `Halt ${index} of ${count} · ${issueLabelOf(halt.ticket)}`;
}

export function haltNameOf({ id }: Halt): string {
  return `Halt ${id}`;
}

function haltHeadingOf(halt: Halt): string {
  return `**${haltNameOf(halt)}**`;
}

export function haltCommentOf(post: HaltPost): string {
  const { halt, ticketTitle } = post;
  const options = [...halt.options, stopSpecOption].map(
    (option, index) => `${index + 1}. ${option}`,
  );
  return [
    `${haltHeadingOf(halt)} · ${haltLabelOf(post)}, "${ticketTitle}" · ${haltKindLabelOf(halt.kind)}`,
    halt.question,
    `Blocks: ${scopeTextOf(halt.scope)}.`,
    `Options:\n${options.join("\n")}`,
    `Answer with a reply naming \`${halt.id}\`: an option, or your own words.`,
  ].join("\n\n");
}

// The notice carries no detail of the Halt itself, which stays in the comment.
export function haltNoticeOf(post: HaltPost): string {
  const { halt } = post;
  return `${haltLabelOf(post)}: a ${haltKindLabelOf(halt.kind)} needs an answer (${halt.id}).`;
}

function scopeTextOf(scope: HaltScope): string {
  if (scope === "spec") return "the whole spec";
  if (scope.length === 0) return "only this ticket";
  return `${scope.join(", ")} and their downstream`;
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

export function isRunnersComment({ body }: IssueComment): boolean {
  return body.includes(runnerMark);
}

export function isStopSpecAnswer({ text }: HaltAnswer): boolean {
  return /\bstop spec\b/i.test(text);
}

export function answeredNoteOf(halt: Halt): string {
  return `${haltNameOf(halt)} answered via a spec-issue reply.`;
}

export function ignoredNoteOf(halt: Halt, reply: IssueComment): string {
  return `${haltNameOf(halt)} was already answered; the later reply \`${reply.id}\` is ignored.`;
}

// Sent with --resume to the implementer whose ticket halted.
export function resumePrompt(halts: Halt[]): string {
  return `The developer answered the Halts this ticket raised. Act on every answer below, then finish the ticket as before: commit on the ticket's branch, run \`npm run check\`, and return the implement record. Nobody is watching this session: never ask a question or wait for an answer.

${answersSection(halts)}`;
}

// Appended to a fresh implement prompt when the implementer's session is gone or past the ticket budget.
export function freshResumeSection(halts: Halt[]): string {
  return `## The developer's answers

This ticket halted on the questions below and the developer answered them. Any work already committed on the ticket's branch is from an earlier step: build on it, acting on every answer.

${answersSection(halts)}`;
}

function answersSection(halts: Halt[]): string {
  const answers = halts.map(
    ({ id, kind, question, answer }) =>
      `### ${id}, a ${haltKindLabelOf(kind)}\n\nQuestion: ${question}\n\nAnswer, verbatim:\n\n${answer?.text ?? ""}`,
  );
  return `When an answer needs no change to the committed work, return the committed record again with each branch's current sha. A question an answer leaves open is a new blocker.

${answers.join("\n\n")}`;
}
