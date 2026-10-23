// The review list: the spec-issue comment a landed ticket's Proposals are posted as, with its Dismisses in a collapsed
// audit, the gap check's comment in the same format, the note a `covered-later` Dismiss leaves on its later ticket,
// and the count of undecided items the end-of-run push gives. The runner only creates these; /judge-findings edits them.
// SpecRun.ts posts them at wrap-up and at the end of the spec; gapCheck.ts supplies the gaps.

import { issueRefOf, type TriageRecord } from "./findingTriage.ts";
import type { Gap, GapCheckRecord } from "./gapCheck.ts";
import { shortRefOf } from "./halts.ts";
import { issueLabelOf, type IssueRef } from "./IssueWorkspaces.ts";

const markPrefix = "<!-- review-list ";
const listMarkPrefix = `${markPrefix}ticket=`;
const undecidedBox = /^- \[ \] \*\*R/gm;

export const gapCheckSubject = "gap-check";

// What one review-list comment is for: a landed ticket, or the gap check.
export type ReviewListSubject = IssueRef | typeof gapCheckSubject;

interface SubjectNames {
  // After `ticket=` in the mark.
  markKey: string;
  // After `R` in an item's id.
  itemKey: string;
  label: string;
}

function namesOf(subject: ReviewListSubject): SubjectNames {
  if (subject === gapCheckSubject) {
    return {
      markKey: gapCheckSubject,
      itemKey: gapCheckSubject,
      label: "the gap check",
    };
  }
  return {
    markKey: `#${subject.number}`,
    itemKey: String(subject.number),
    label: issueLabelOf(subject),
  };
}

export function reviewListMarkOf(subject: ReviewListSubject): string {
  return `${listMarkPrefix}${namesOf(subject).markKey} -->`;
}

function itemIdOf(subject: ReviewListSubject, index: number): string {
  return `R${namesOf(subject).itemKey}.${index + 1}`;
}

// Triage refuses a record missing what its verdict and reason need, so a missing one here is a bug.
function requiredOf(record: TriageRecord, field: keyof TriageRecord): string {
  const value = record[field];
  if (typeof value !== "string") {
    throw new Error(`Finding ${record.finding} has no \`${field}\`.`);
  }
  return value;
}

interface ReviewItem {
  heading: string;
  evidence: string;
  recommendation: string;
  draftIssueTitle?: string;
  draftKeepReason?: string;
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
  if (item.draftKeepReason !== undefined) {
    lines.push(`  Drafted keep: "${item.draftKeepReason}"`);
  }
  return lines.join("\n");
}

export interface TicketReviewList {
  ticket: IssueRef;
  title: string;
  // Every triage record the ticket kept, from either side of a Halt.
  records: TriageRecord[];
}

// Undefined for a ticket with no Proposals, which posts no comment.
export function ticketReviewListOf({
  ticket,
  title,
  records,
}: TicketReviewList): string | undefined {
  const proposals = records.filter(({ verdict }) => verdict === "propose");
  if (proposals.length === 0) return undefined;
  const items = proposals.map((record, index) =>
    itemOf(itemIdOf(ticket, index), proposeItemOf(record)),
  );
  const dismisses = records.filter(({ verdict }) => verdict === "dismiss");
  return [
    reviewListMarkOf(ticket),
    `**Review list** · ${issueLabelOf(ticket)}, "${title}"`,
    items.join("\n"),
    ...(dismisses.length > 0 ? [dismissAuditOf(dismisses)] : []),
  ].join("\n\n");
}

function proposeItemOf(record: TriageRecord): ReviewItem {
  const { finding, claim, where, evidence, draftKeepReason } = record;
  const reason = requiredOf(record, "reason");
  return {
    heading: `Propose \`${reason}\` · Finding ${finding}: ${claim} (${where})`,
    evidence,
    recommendation: requiredOf(record, "recommendation"),
    draftIssueTitle:
      reason === "ticket" ? requiredOf(record, "draftIssueTitle") : undefined,
    draftKeepReason,
  };
}

// No checkboxes, so a Dismiss never counts as undecided.
function dismissAuditOf(dismisses: TriageRecord[]): string {
  const lines = dismisses.map(dismissLineOf);
  return `<details>\n<summary>Dismissed: ${dismisses.length}</summary>\n\n${lines.join("\n")}\n\n</details>`;
}

function dismissLineOf(record: TriageRecord): string {
  const { finding, claim, where, evidence } = record;
  const reason = requiredOf(record, "reason");
  const line = `- Finding ${finding} · \`${reason}\` · ${claim} (${where}). ${evidence}`;
  if (reason === "kept") {
    return `${line} Kept for: ${requiredOf(record, "quote")}`;
  }
  if (reason === "covered-later") {
    return `${line} Covered by ${requiredOf(record, "coveredBy")}.`;
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
    const mark = `${markPrefix}note=${shortRefOf(ticket)}.${record.finding} -->`;
    const body = `${mark}\n${shortRefOf(ticket)}'s review left this for this ticket to cover: ${record.claim} (${record.where}).`;
    return [{ issue, mark, body }];
  });
}

export interface UndecidedCount {
  items: number;
  // Tickets whose review list has at least one undecided item.
  tickets: number;
  hasUndecidedGaps: boolean;
}

// Counts unticked boxes, so an item /judge-findings or a hand tick decided no longer counts.
export function undecidedCountOf(bodies: string[]): UndecidedCount {
  const gapCheckMark = reviewListMarkOf(gapCheckSubject);
  return bodies
    .filter((body) => body.includes(listMarkPrefix))
    .reduce<UndecidedCount>(
      (count, body) => {
        const items = body.match(undecidedBox)?.length ?? 0;
        count.items += items;
        if (items === 0) return count;
        if (body.includes(gapCheckMark)) count.hasUndecidedGaps = true;
        else count.tickets += 1;
        return count;
      },
      { items: 0, tickets: 0, hasUndecidedGaps: false },
    );
}

// The gap check is named on its own, since it is no ticket.
export function undecidedLineOf({
  items,
  tickets,
  hasUndecidedGaps,
}: UndecidedCount): string {
  const across = [
    ...(tickets > 0
      ? [`${tickets} ${tickets === 1 ? "ticket" : "tickets"}`]
      : []),
    ...(hasUndecidedGaps ? ["the gap check"] : []),
  ];
  return `review list: ${items} undecided across ${across.join(" and ")}`;
}

export function ticketPushOf(
  subject: ReviewListSubject,
  items: number,
): string {
  return `review list: ${items} undecided on ${namesOf(subject).label}`;
}
