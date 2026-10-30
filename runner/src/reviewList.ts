// The review list: a ticket's resolve records by axis then verdict, its Proposals as R items, its agreed Dismisses in a
// collapsed audit, each departure from a suggested verdict with its why; a run posts it on the spec, a session prints it.
// Also the gap check's comment in the same format, the note a `covered-later` Dismiss leaves on its later ticket,
// and the count of undecided items the end-of-run push gives. The runner only creates these; /judge-findings edits them.
// SpecRun/ReviewListPoster.ts posts them, TicketLander.ts calling it at landing; SpecRun/SessionReviewer.ts returns a
// ticket's to print; gapCheck.ts supplies the gaps.

import type { Gap, GapCheckRecord } from "./gapCheck.ts";
import { shortRefOf } from "./halts.ts";
import { issueLabelOf, type IssueRef } from "./IssueWorkspaces.ts";
import type { MergeMasterRecord } from "./mergeMasterStep.ts";
import { issueRefOf, type ResolveRecord } from "./resolveStep.ts";
import type { Axis, Verdict } from "./verdicts.ts";

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

// Resolve refuses a record missing what its verdict and reason need, so a missing one here is a bug.
function requiredOf(record: ResolveRecord, field: keyof ResolveRecord): string {
  const value = record[field];
  if (typeof value !== "string") {
    throw new Error(`Finding ${record.finding} has no \`${field}\`.`);
  }
  return value;
}

interface ReviewItem {
  heading: string;
  // `Evidence: …`, or a departure from the suggested verdict, which carries its evidence.
  evidenceLine: string;
  recommendation: string;
  draftIssueTitle?: string;
  draftKeepReason?: string;
}

function itemOf(id: string, item: ReviewItem): string {
  const lines = [
    `- [ ] **${id}** · ${item.heading}`,
    `  ${item.evidenceLine}`,
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
  // Every resolve record the ticket kept, from either side of a Halt.
  records: ResolveRecord[];
  // Set when a merge-master step resolved the wrap-up's conflict.
  mergeMasterRecord?: MergeMasterRecord;
  // Set when a merge-master step ran but kept no record, so its merge still gets a Propose.
  unrecordedMerge?: string;
}

// A ticket's groups, each key order the order shown; the merge with master comes after the axes.
const reviewGroups = {
  axes: {
    standards: "### Standards",
    spec: "### Spec",
  },
  mergeMaster: "### Merge with master",
  verdicts: {
    fix: { heading: "Fixed", word: "Fix" },
    propose: { heading: "Proposed", word: "Propose" },
    dismiss: { heading: "Dismissed", word: "Dismiss" },
    halt: { heading: "Halted", word: "Halt" },
  },
} as const satisfies {
  axes: Record<Axis, string>;
  mergeMaster: string;
  verdicts: Record<Verdict, { heading: string; word: string }>;
};

const shownAxes = Object.keys(reviewGroups.axes) as Axis[];
const shownVerdicts = Object.keys(reviewGroups.verdicts) as Verdict[];

// The run's comment and the interactive printout alike; undefined for a review that kept no records and no merge.
export function ticketReviewListOf({
  ticket,
  title,
  records,
  mergeMasterRecord,
  unrecordedMerge,
}: TicketReviewList): string | undefined {
  const mergeItem = mergeItemOf(mergeMasterRecord, unrecordedMerge);
  if (records.length === 0 && mergeItem === undefined) return undefined;
  const groups = groupsOf(records);
  // Numbered in the order shown, so R<ticket>.1 is the first Proposal read.
  const proposals = shownAxes.flatMap((axis) => groups[axis].propose);
  const sections = shownAxes.flatMap((axis) => {
    const shown = shownVerdicts.flatMap((verdict) =>
      verdictGroupOf(groups[axis][verdict], verdict, (record) =>
        itemIdOf(ticket, proposals.indexOf(record)),
      ),
    );
    return shown.length === 0 ? [] : [reviewGroups.axes[axis], ...shown];
  });
  if (mergeItem !== undefined) {
    const id = itemIdOf(ticket, proposals.length);
    sections.push(mergeMasterSectionOf(id, mergeItem));
  }
  return [
    reviewListMarkOf(ticket),
    `**Review list** · ${issueLabelOf(ticket)}, "${title}"`,
    ...sections,
  ].join("\n\n");
}

// Checks catch a broken merge, not a wrong call on whose intent won, so the developer confirms each resolution.
function mergeItemOf(
  record: MergeMasterRecord | undefined,
  unrecordedMerge: string | undefined,
): ReviewItem | undefined {
  if (record !== undefined) {
    return {
      heading: proposeHeadingOf(
        "decision",
        `The merge with master resolved conflicts in ${record.files.join(", ")}`,
      ),
      evidenceLine: `Evidence: ${record.summary}`,
      recommendation:
        "Confirm each resolution kept the intent you want from both sides; correct it on master if not.",
    };
  }
  if (unrecordedMerge === undefined) return undefined;
  return {
    heading: proposeHeadingOf(
      "decision",
      "The merge with master resolved conflicts it kept no record of",
    ),
    evidenceLine: `Evidence: ${unrecordedMerge}`,
    recommendation:
      "Read the merge commit on the ticket's branch, and confirm each resolution kept the intent you want from both sides; correct it on master if not.",
  };
}

function mergeMasterSectionOf(id: string, mergeItem: ReviewItem): string {
  const item = itemOf(id, mergeItem);
  return `${reviewGroups.mergeMaster}\n\n${groupBlockOf("propose", [item])}`;
}

function proposeHeadingOf(reason: string, subject: string): string {
  return `${reviewGroups.verdicts.propose.word} \`${reason}\` · ${subject}`;
}

type RecordGroups = Record<Axis, Record<Verdict, ResolveRecord[]>>;

function groupsOf(records: ResolveRecord[]): RecordGroups {
  const groups: RecordGroups = {
    standards: emptyVerdictGroupsOf(),
    spec: emptyVerdictGroupsOf(),
  };
  records.forEach((record) => {
    groups[record.axis][record.verdict].push(record);
  });
  return groups;
}

function emptyVerdictGroupsOf(): Record<Verdict, ResolveRecord[]> {
  return { fix: [], propose: [], dismiss: [], halt: [] };
}

function verdictGroupOf(
  records: ResolveRecord[],
  verdict: Verdict,
  proposalIdOf: (record: ResolveRecord) => string,
): string[] {
  if (records.length === 0) return [];
  if (verdict === "dismiss") return dismissGroupOf(records);
  const rows = records.map((record) => {
    if (verdict === "propose") {
      return itemOf(proposalIdOf(record), proposeItemOf(record));
    }
    if (verdict === "halt") return haltRowOf(record);
    return fixRowOf(record);
  });
  return [groupBlockOf(verdict, rows)];
}

function groupBlockOf(verdict: Verdict, rows: string[]): string {
  return `**${reviewGroups.verdicts[verdict].heading}**\n\n${rows.join("\n")}`;
}

// Undefined where the resolver kept the reviewer's verdict, or the record predates suggested verdicts.
function departureOf({
  suggestedVerdict,
  verdict,
  evidence,
}: ResolveRecord): string | undefined {
  if (suggestedVerdict === undefined || suggestedVerdict === verdict) {
    return undefined;
  }
  const from = reviewGroups.verdicts[suggestedVerdict].word;
  return `suggested ${from} → ${reviewGroups.verdicts[verdict].word}: ${evidence}`;
}

function departureLinesOf(record: ResolveRecord): string[] {
  const departure = departureOf(record);
  return departure === undefined ? [] : [`  ${departure}`];
}

function findingHeadOf({ finding, claim, where }: ResolveRecord): string {
  return `Finding ${finding}: ${claim} (${where})`;
}

function evidenceLineOf(record: ResolveRecord): string {
  return departureOf(record) ?? `Evidence: ${record.evidence}`;
}

function fixRowOf(record: ResolveRecord): string {
  return [`- ${findingHeadOf(record)}`, ...departureLinesOf(record)].join("\n");
}

function haltRowOf(record: ResolveRecord): string {
  return [
    `- ${findingHeadOf(record)}`,
    `  ${evidenceLineOf(record)}`,
    `  Recommendation: ${requiredOf(record, "recommendation")}`,
  ].join("\n");
}

function proposeItemOf(record: ResolveRecord): ReviewItem {
  const reason = requiredOf(record, "reason");
  return {
    heading: proposeHeadingOf(reason, findingHeadOf(record)),
    evidenceLine: evidenceLineOf(record),
    recommendation: requiredOf(record, "recommendation"),
    draftIssueTitle:
      reason === "ticket" ? requiredOf(record, "draftIssueTitle") : undefined,
    draftKeepReason: record.draftKeepReason,
  };
}

// An overruled Dismiss is shown; only the agreed ones collapse, with no checkboxes, so none counts as undecided.
function dismissGroupOf(dismisses: ResolveRecord[]): string[] {
  const overruled = dismisses.filter(
    (record) => departureOf(record) !== undefined,
  );
  const agreed = dismisses.filter(
    (record) => departureOf(record) === undefined,
  );
  const shown = overruled.map((record) =>
    [overruledDismissLineOf(record), ...departureLinesOf(record)].join("\n"),
  );
  return [
    ...(shown.length > 0 ? [groupBlockOf("dismiss", shown)] : []),
    ...(agreed.length > 0 ? [dismissAuditOf(agreed)] : []),
  ];
}

// Its evidence is on the departure line below it.
function overruledDismissLineOf(record: ResolveRecord): string {
  const details = dismissDetailsOf(record);
  if (details.length === 0) return `- ${dismissHeadOf(record)}`;
  return `- ${[`${dismissHeadOf(record)}.`, ...details].join(" ")}`;
}

function dismissAuditOf(dismisses: ResolveRecord[]): string {
  const lines = dismisses.map((record) => {
    const sentences = [`${dismissHeadOf(record)}.`, record.evidence];
    return `- ${[...sentences, ...dismissDetailsOf(record)].join(" ")}`;
  });
  return `<details>\n<summary>Dismissed: ${dismisses.length}</summary>\n\n${lines.join("\n")}\n\n</details>`;
}

function dismissHeadOf(record: ResolveRecord): string {
  const { finding, claim, where } = record;
  const reason = requiredOf(record, "reason");
  return `Finding ${finding} · \`${reason}\` · ${claim} (${where})`;
}

function dismissDetailsOf(record: ResolveRecord): string[] {
  if (record.reason === "kept") {
    return [`Kept for: ${requiredOf(record, "quote")}`];
  }
  if (record.reason === "covered-later") {
    return [`Covered by ${requiredOf(record, "coveredBy")}.`];
  }
  return [];
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
  return {
    heading: `Gap · ${ask}`,
    evidenceLine: `Evidence: ${evidence}`,
    recommendation,
    draftIssueTitle,
  };
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
  records: ResolveRecord[],
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
