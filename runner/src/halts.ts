// Halts: the Halts a ticket's steps raise, the spec-issue comment and notice line each is posted as, how a developer's
// reply answers one, and the prompt that hands every answer back to the ticket's resumed or fresh implementer.
// SpecRun.ts keeps them in run state, blocks the tickets in their scope and resumes the halted ticket once all are answered.

import type { HaltScope, TriageRecord } from "./findingTriage.ts";
import { giveUpReasons } from "./fixStep.ts";
import type { Blocker } from "./implementStep.ts";
import { issueLabelOf, type IssueRef } from "./IssueWorkspaces.ts";

// Marks every comment the runner posts, which carries the developer's login too, so none is read as an answer.
export const runnerMark = "<!-- spec-runner -->";

const stopSpecOption = "`stop spec`";

const kindLabels = {
  verdict: "triage Halt",
  "give-up": "fixer give-up",
  "gated-action": "gated-action blocker",
  "spec-ambiguity": "spec-ambiguity blocker",
  "denied-tool": "denied-tool blocker",
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
  "kind" | "question" | "options" | "scope" | "finding"
>;

export interface Reply {
  id: string;
  author: string;
  body: string;
}

export function shortRefOf({ repo, number }: IssueRef): string {
  return `${repo}#${number}`;
}

export function haltKindLabelOf(kind: HaltKind): string {
  return kindLabels[kind];
}

// A blocker's Halt holds the tickets downstream of its own; with none downstream it holds the spec.
export function blockerHaltOf(
  { kind, detail, recommendation }: Blocker,
  downstream: string[],
): HaltDraft {
  const options = [recommendation];
  if (kind === "denied-tool") {
    options.push("Add it to the ticket's `## Targets`, then resume");
  }
  return { kind, question: detail, options, scope: scopeOf(downstream) };
}

// The fixer's give-ups arrive already rewritten as Halt records by giveUpRecordOf().
export function triageHaltOf(record: TriageRecord): HaltDraft {
  const { finding, claim, where, evidence, reason, recommendation } = record;
  const isGiveUp = (giveUpReasons as readonly string[]).includes(reason ?? "");
  return {
    kind: isGiveUp ? "give-up" : "verdict",
    question: `Finding ${finding}: ${claim} (${where}) ${evidence}`,
    options: [recommendation ?? ""],
    scope: record.haltScope ?? "spec",
    finding,
  };
}

export function scopeOf(downstream: string[]): HaltScope {
  return downstream.length > 0 ? downstream : "spec";
}

export interface HaltPost {
  halt: Halt;
  // Its place among the Halts posted for its ticket at once, from 1.
  index: number;
  count: number;
  ticketTitle: string;
}

export function haltLabelOf({ halt, index, count }: HaltPost): string {
  return `Halt ${index} of ${count} · ${issueLabelOf(halt.ticket)}`;
}

export function haltCommentOf(post: HaltPost): string {
  const { halt, ticketTitle } = post;
  const options = [...halt.options, stopSpecOption].map(
    (option, index) => `${index + 1}. ${option}`,
  );
  return [
    runnerMark,
    `**Halt ${halt.id}** · ${haltLabelOf(post)}, "${ticketTitle}" · ${haltKindLabelOf(halt.kind)}`,
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
  return `${scope.join(", ")} and their downstream`;
}

// The developer's replies naming the Halt, oldest first; the runner's own comments are never among them.
export function repliesTo(
  halt: Halt,
  replies: Reply[],
  developer: string,
): Reply[] {
  const naming = new RegExp(`(^|[^\\w])${halt.id}(?!\\w)`, "i");
  return replies.filter(
    ({ author, body }) =>
      author === developer && !body.includes(runnerMark) && naming.test(body),
  );
}

export function isStopSpecAnswer({ text }: HaltAnswer): boolean {
  return /\bstop spec\b/i.test(text);
}

export function answeredNoteOf(halt: Halt): string {
  return `${runnerMark}\nHalt ${halt.id} answered via a spec-issue reply.`;
}

export function ignoredNoteOf(halt: Halt, reply: Reply): string {
  return `${runnerMark}\nHalt ${halt.id} was already answered; the later reply \`${reply.id}\` is ignored.`;
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
