// The review list: the spec-issue comment a landed ticket's Defers are posted as, with its Dismisses in a collapsed
// audit, the gap check's comment in the same format, the note a `covered-later` Dismiss leaves on its later ticket,
// and the count of undecided items the end-of-run push gives. The runner only creates these; /judge-findings edits them.
// SpecRun.ts posts them at wrap-up and at the end of the spec; gapCheck.ts supplies the gaps.

import { issueRefOf, type TriageRecord } from "./findingTriage.ts";
import type { Gap, GapCheckRecord } from "./gapCheck.ts";
import { shortRefOf } from "./halts.ts";
import { issueLabelOf, type IssueRef } from "./IssueWorkspaces.ts";

const gapCheckKey = "gap-check";
const undecidedBox = /^- \[ \] \*\*R/gm;

// What one review-list comment is for: a landed ticket, or the gap check.
export type ReviewListSubject = IssueRef | typeof gapCheckKey;

export const gapCheckSubject: ReviewListSubject = gapCheckKey;

export function reviewListMarkOf(subject: ReviewListSubject): string {
  return `<!-- review-list ticket=${keyOf(subject)} -->`;
}

function keyOf(subject: ReviewListSubject): string {
  return subject === gapCheckKey ? gapCheckKey : `#${subject.number}`;
}

function itemIdOf(subject: ReviewListSubject, index: number): string {
  const key = subject === gapCheckKey ? gapCheckKey : String(subject.number);
  return `R${key}.${index + 1}`;
}

interface ReviewItem {
  heading: string;
  evidence: string;
  recommendation: string;
  draftIssueTitle?: string;
}

function itemOf(id: string, item: ReviewItem): string {
  const lines = [
    `- [ ] **${id}** · ${item.heading}`,
    `  Evidence: ${item.evidence}`,
    `  Recommendation: ${item.recommendation}`,
  ];
  if (item.draftIssueTitle !== undefined) {
    lines.push(`  Drafted issue: "${item.draftIssueTitle}"`);
  }
  return lines.join("\n");
}

export interface TicketReviewList {
  ticket: IssueRef;
  title: string;
  // Every triage record the ticket kept, from either side of a Halt, a fixer's rewritten give-ups included.
  records: TriageRecord[];
}

// Undefined for a ticket with no Defers, which posts no comment.
export function ticketReviewListOf({
  ticket,
  title,
  records,
}: TicketReviewList): string | undefined {
  const defers = records.filter(({ verdict }) => verdict === "defer");
  if (defers.length === 0) return undefined;
  const items = defers.map((record, index) =>
    itemOf(itemIdOf(ticket, index), deferItemOf(record)),
  );
  const dismisses = records.filter(({ verdict }) => verdict === "dismiss");
  return [
    reviewListMarkOf(ticket),
    `**Review list** · ${issueLabelOf(ticket)}, "${title}"`,
    items.join("\n"),
    ...(dismisses.length > 0 ? [dismissAuditOf(dismisses)] : []),
  ].join("\n\n");
}

function deferItemOf(record: TriageRecord): ReviewItem {
  const { finding, claim, where, reason, evidence, recommendation } = record;
  return {
    heading: `Defer \`${reason ?? ""}\` · Finding ${finding}: ${claim} (${where})`,
    evidence,
    recommendation: recommendation ?? "",
    draftIssueTitle: reason === "ticket" ? record.draftIssueTitle : undefined,
  };
}

// No checkboxes, so a Dismiss never counts as undecided.
function dismissAuditOf(dismisses: TriageRecord[]): string {
  const lines = dismisses.map(dismissLineOf);
  return `<details>\n<summary>Dismissed: ${dismisses.length}</summary>\n\n${lines.join("\n")}\n\n</details>`;
}

function dismissLineOf(record: TriageRecord): string {
  const { finding, claim, where, reason, evidence } = record;
  const line = `- Finding ${finding} · \`${reason ?? ""}\` · ${claim} (${where}). ${evidence}`;
  if (reason === "kept") return `${line} Kept for: ${record.quote ?? ""}`;
  if (reason === "covered-later") {
    return `${line} Covered by ${record.coveredBy ?? ""}.`;
  }
  return line;
}

export function gapCheckListOf(
  specTitle: string,
  record: GapCheckRecord,
): string {
  const heading = `**Review list** · gap check, "${specTitle}"`;
  const mark = reviewListMarkOf(gapCheckSubject);
  if (record.gaps.length === 0) {
    return [mark, heading, "The gap check found no gaps."].join("\n\n");
  }
  const items = record.gaps.map((gap, index) =>
    itemOf(itemIdOf(gapCheckSubject, index), gapItemOf(gap)),
  );
  return [mark, heading, items.join("\n")].join("\n\n");
}

function gapItemOf({
  ask,
  evidence,
  recommendation,
  draftIssueTitle,
}: Gap): ReviewItem {
  return { heading: `Gap · ${ask}`, evidence, recommendation, draftIssueTitle };
}

export interface CoveredLaterNote {
  // The later ticket the Dismiss names.
  issue: IssueRef;
  mark: string;
  body: string;
}

// Each `covered-later` Dismiss's note, for its later ticket's reviewer to check.
export function coveredLaterNotesOf(
  ticket: IssueRef,
  records: TriageRecord[],
): CoveredLaterNote[] {
  return records.flatMap((record) => {
    if (record.verdict !== "dismiss" || record.reason !== "covered-later") {
      return [];
    }
    // A record checked before `coveredBy` had to be `<repo>#<n>` may name no ticket.
    const issue = issueRefOf(record.coveredBy);
    if (issue === undefined) return [];
    const mark = `<!-- review-list note=${shortRefOf(ticket)}.${record.finding} -->`;
    const body = `${mark}\n${shortRefOf(ticket)}'s review left this for this ticket to cover: ${record.claim} (${record.where}).`;
    return [{ issue, mark, body }];
  });
}

export interface UndecidedCount {
  items: number;
  // Review-list comments with at least one undecided item.
  lists: number;
}

// Counts unticked boxes, so an item /judge-findings or a hand tick decided no longer counts.
export function undecidedCountOf(bodies: string[]): UndecidedCount {
  return bodies
    .filter((body) => body.includes("<!-- review-list ticket="))
    .reduce(
      (count, body) => {
        const items = body.match(undecidedBox)?.length ?? 0;
        count.items += items;
        if (items > 0) count.lists += 1;
        return count;
      },
      { items: 0, lists: 0 },
    );
}

export function undecidedLineOf({ items, lists }: UndecidedCount): string {
  return `review list: ${items} undecided across ${lists} ${lists === 1 ? "ticket" : "tickets"}`;
}

export function ticketPushOf(
  subject: ReviewListSubject,
  items: number,
): string {
  const label =
    subject === gapCheckKey ? "the gap check" : issueLabelOf(subject);
  return `review list: ${items} undecided on ${label}`;
}
