// Halts: the Halts a ticket's steps raise, the spec-issue comment and notice line each is posted as, and the prompt
// that hands every answer back to the ticket's resumed or fresh implementer; which replies answer one is ./halts/haltReplies.ts.
// SpecRun.ts keeps them in run state, blocks the tickets in their scope and resumes the halted ticket once all are answered.

import { type IssueRef, issueRef } from "./IssueWorkspaces.ts";
import { outlineEdits } from "./outlineEdits.ts";
import { bulletsOf } from "./promptText.ts";
import type { IssueComment, TicketStep } from "./SpecRun.ts";
import { handoffText } from "./stepPrompts/handoffText.ts";
import {
  type Blocker,
  type HaltScope,
  haltScopeOf,
  type OutlineEdit,
  type ProposedSlice,
  type ResolveRecord,
} from "./stepRecords.ts";
import { isTargetWrite } from "./targetTools.ts";

// Marks every comment the runner posts, which carries the developer's login too, so none is read as an answer.
export const runnerMark = "<!-- spec-runner -->";

const stopSpecOption = "`stop spec`";

const kindLabels = {
  verdict: "verdict Halt",
  // Only in run state saved before #363, when a separate step could give a finding up.
  "give-up": "resolver give-up",
  "gated-action": "gated-action blocker",
  "spec-ambiguity": "spec-ambiguity blocker",
  "denied-tool": "denied-tool blocker",
  failure: "Failure Halt",
  split: "Split Halt",
  research: "Research Halt",
  push: "Push Halt",
} as const;

export type HaltKind = keyof typeof kindLabels;

export interface Halt {
  // `H<n>`, numbered across the spec's run, which reads a reply opening with it; `S<ticket>.<k>` for a session's review.
  id: string;
  // The halted ticket.
  ticket: IssueRef;
  kind: HaltKind;
  question: string;
  // The recommendations, without `stop spec`, which every Halt offers.
  options: string[];
  scope: HaltScope;
  // The finding it came from, if any.
  finding?: number;
  // A Failure Halt's step, which a `retry` answer runs again.
  failedStep?: FailedStep;
  // The hash of the body a launch-time authorship check saw; `approve` approves that text alone.
  bodyHash?: string;
  // A Research Halt's proposed edits, which its answer approves by `E<n>`.
  outlineEdits?: OutlineEdit[];
  // A push Halt's Section, by its heading; the latest push Halt on it holds the answer the push acts on.
  pushSection?: string;
  isPosted: boolean;
  answer?: HaltAnswer;
  // Set once the answer reached the resumed or fresh implementer; on a Research Halt, once the edits it approves are applied.
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

export type AnsweredHalt = Halt & { answer: HaltAnswer };

export function isAnswered(halt: Halt | undefined): halt is AnsweredHalt {
  return halt?.answer !== undefined;
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
  | "bodyHash"
  | "outlineEdits"
  | "pushSection"
>;

// What a Workflow words of a Halt it asks for; the core adds the rest.
export type HaltQuestion = Pick<Halt, "question" | "options">;

export function shortRefOf({ repo, number }: IssueRef): string {
  return `${repo}#${number}`;
}

export function haltKindLabelOf(kind: HaltKind): string {
  return kindLabels[kind];
}

export interface BlockerHaltFacts {
  downstream: string[];
  deniedTools: string[];
}

// A blocker's Halt holds its own ticket and the tickets downstream of it.
export function blockerHaltOf(
  { kind, detail, recommendation }: Blocker,
  { downstream, deniedTools }: BlockerHaltFacts,
): HaltDraft {
  const options = [recommendation];
  if (kind === "denied-tool" && deniedTools.some(isTargetWrite)) {
    options.push("Add it to the ticket's `## Targets`, then resume");
  }
  return { kind, question: detail, options, scope: downstream };
}

// Any answer but `stop spec` is a `continue`: a fresh step on the ticket's body as it then reads.
export function splitHaltOf(
  slices: ProposedSlice[],
  downstream: string[],
): HaltDraft {
  return {
    kind: "split",
    question: `The implement step handed off with less than half the ticket done, and proposed splitting the rest into:\n\n${handoffText.proposedSplitOf(slices)}\n\n${splitTheTicketPhraseOf("`continue`")}: a fresh implement step picks up from the handoff on the ticket's body as it then reads.`,
    options: ["`continue`"],
    scope: downstream,
  };
}

// Raised on the Research Halt's ticket and scope, so drafting never starts on an Outline the developer didn't settle; any answer but `stop spec` goes on.
export function unappliedEditsHaltOf(
  halt: Halt,
  unapplied: OutlineEdit[],
): HaltDraft {
  const edits = halt.outlineEdits ?? [];
  const lines = unapplied.map((edit) =>
    outlineEdits.lineOf(edit, edits.indexOf(edit)),
  );
  return {
    kind: "research",
    question: `${haltNameOf(halt)}'s answer approved these Outline edits, but the runner couldn't apply them: each one's ${outlineEdits.unappliedReason}.${bulletsOf(lines)}\n\nMake each change in the spec's \`## Outline\` by hand, then answer \`continue\`.`,
    options: ["`continue`"],
    scope: halt.scope,
  };
}

export const pushOptions = {
  overwrite: "`overwrite`",
  keepMine: "`keep mine`",
} as const;

// How an agent Section the push would write differs from the pull baseline in the Doc.
export type PushConflict = "changed" | "missing";

// Raised on the spec issue, since the push belongs to no ticket; it writes nothing until every one is answered.
export function pushHaltOf(heading: string, conflict: PushConflict): HaltDraft {
  const { overwrite, keepMine } = pushOptions;
  const keepMineText = `answer ${keepMine} to leave the Doc as it is and mark the Section as yours in the Agent draft`;
  const questions: Record<PushConflict, string> = {
    changed: `"${heading}" changed in the Doc since the pull, and the push never writes over your edits unasked. Answer ${overwrite} to write the agent text over yours, or ${keepMineText}.`,
    missing: `The Doc has no "${heading}" heading, so the push has nowhere to write the agent text. Add it, then answer ${overwrite} to write the agent text under it; or ${keepMineText}.`,
  };
  return {
    kind: "push",
    question: questions[conflict],
    options: [overwrite, keepMine],
    scope: [],
    pushSection: heading,
  };
}

// On no Section, since the suggestions hold every write into the Doc; any answer but `stop spec` pushes again.
export function suggestionsHaltOf(documentId: string): HaltDraft {
  return {
    kind: "push",
    question: `Doc ${documentId} holds pending suggestions, so the push can't place its writes in it safely. Accept or reject each suggestion in the Doc, then answer \`continue\`.`,
    options: ["`continue`"],
    scope: [],
  };
}

export interface HandoffCap {
  ticket: IssueRef;
  count: number;
  cap: number;
  // A split the capped handoff proposed; empty when none, or a Halt already carried it.
  slices: ProposedSlice[];
}

export function handoffCapDetailOf({
  ticket,
  count,
  cap,
  slices,
}: HandoffCap): string {
  const split =
    slices.length > 0
      ? ` The last handoff proposed splitting the rest into:\n\n${handoffText.proposedSplitOf(slices)}\n\n`
      : " ";
  return `${issueRef.labelOf(ticket)} handed off ${count} times, past its cap of ${cap}.${split}${splitTheTicketPhraseOf(failureOptions.moreHandoffs)}.`;
}

function splitTheTicketPhraseOf(answer: string): string {
  return `Split the ticket, narrowing its body and moving the rest to new tickets, then answer ${answer}`;
}

export function verdictHaltOf(record: ResolveRecord): HaltDraft {
  const { finding, claim, where, evidence, recommendation } = record;
  return {
    kind: "verdict",
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
  bodyHash?: string;
}

export const failureOptions = {
  retry: "`retry`",
  retryRecord: "`retry record`",
  moreHandoffs: "`continue +1 handoff`",
  approve: "`approve`",
  skip: "`skip`",
} as const;

// Any answer but `stop spec` and `skip` runs the step again with a fresh count.
export function failureHaltOf(
  {
    step,
    detail,
    logPath,
    options = [failureOptions.retry],
    bodyHash,
  }: StepFailure,
  downstream: string[],
): HaltDraft {
  return {
    kind: "failure",
    question: `${detail}\n\nLog: \`${logPath}\``,
    options,
    scope: downstream,
    failedStep: step,
    bodyHash,
  };
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
  return `Halt ${index} of ${count} · ${issueRef.labelOf(halt.ticket)}`;
}

export function haltNameOf({ id }: Halt): string {
  return `Halt ${id}`;
}

export function haltHeadingOf(halt: Halt): string {
  return `**${haltNameOf(halt)}**`;
}

export function haltCommentOf(post: HaltPost): string {
  const { halt } = post;
  return haltCommentWith(post, {
    options: [...halt.options, stopSpecOption],
    answerLine: `Answer with a reply that opens with \`${halt.id}:\`, then an option or your own words.`,
  });
}

// Never a run's `H<n>`, so a run never reads a reply to one.
export function sessionHaltIdOf(ticket: IssueRef, index: number): string {
  return `${sessionHaltPrefixOf(ticket)}${index}`;
}

// The ticket's session Halts among the spec's comments, one per comment.
export function sessionHaltCountOf(
  ticket: IssueRef,
  comments: string[],
): number {
  const heading = `**Halt ${sessionHaltPrefixOf(ticket)}`;
  return comments.filter((body) => body.includes(heading)).length;
}

function sessionHaltPrefixOf({ number }: IssueRef): string {
  return `S${number}.`;
}

// No run reads a reply to it, and with no run going there is no spec to stop.
export function sessionHaltCommentOf(post: HaltPost): string {
  const { halt } = post;
  return haltCommentWith(post, {
    // A Failure Halt's answers are a run's, and a review keeps no state to resume.
    options:
      halt.kind === "failure"
        ? ["Review the ticket again once the failure's cause is fixed."]
        : halt.options,
    answerLine:
      "Answer it in the interactive session that ran the review; no run reads a reply to it.",
  });
}

interface HaltCommentParts {
  options: string[];
  answerLine: string;
}

function haltCommentWith(
  post: HaltPost,
  { options, answerLine }: HaltCommentParts,
): string {
  const { halt, ticketTitle } = post;
  const numbered = options.map((option, index) => `${index + 1}. ${option}`);
  return [
    `${haltHeadingOf(halt)} · ${haltLabelOf(post)}, "${ticketTitle}" · ${haltKindLabelOf(halt.kind)}`,
    halt.question,
    `Blocks: ${scopeTextOf(halt.scope)}.`,
    `Options:\n${numbered.join("\n")}`,
    answerLine,
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

export function isRunnersComment({ body }: IssueComment): boolean {
  return body.includes(runnerMark);
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
