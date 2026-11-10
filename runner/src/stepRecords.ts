// The records the steps return, with the types and reasons they share and the small readers of them: the core's halts,
// review list, run state and facts file read them without importing a step's prompt. Each step's schema stays in its own file.

import type { GitHubWrite, UndoneBox } from "./FactsFile.ts";
import type { IssueRef } from "./IssueWorkspaces.ts";
import type { Axis, Verdict } from "./verdicts.ts";

export type ImplementRecord =
  CommittedRecord | AppliedRecord | BlockedRecord | HandoffRecord;

export interface CommittedRecord extends RecordBody {
  status: "committed";
}

// A ticket that needed only GitHub writes and no code.
export interface AppliedRecord extends RecordBody {
  status: "applied";
  githubWrites: GitHubWrite[];
}

export interface BlockedRecord extends RecordBody {
  status: "blocked";
}

export interface HandoffRecord extends RecordBody {
  status: "handoff";
  handoff: Handoff;
}

interface RecordBody {
  // In landing order: a repo lands before any repo that depends on it.
  branches: CommittedBranch[];
  closingComment: string;
  boxesUndone: UndoneBox[];
  blockers: Blocker[];
}

// A piece spec's drafting ticket's implement record: code's without `applied`, since a drafting ticket always drafts.
export type PieceImplementRecord =
  DraftedRecord | BlockedRecord | HandoffRecord;

export interface DraftedRecord extends CommittedRecord {
  // Each heading's exact text, as the Agent draft holds it.
  sectionsDrafted: string[];
}

// What an implement record's schema can't see: whether the step's status matches the commits git shows it made.
export function implementRecordProblems(
  record: ImplementRecord,
  hasNewCommit: boolean,
): string[] {
  if (record.status === "committed" && !hasNewCommit) {
    return ["the record says committed, but the step made no new commit"];
  }
  if (record.status === "handoff" && hasNewCommit) {
    return [newCommitProblem("a handoff must leave its work uncommitted")];
  }
  if (record.status === "applied" && hasNewCommit) {
    return [newCommitProblem("an applied record must commit nothing")];
  }
  if (record.status === "blocked" && hasNewCommit) {
    return [newCommitProblem("a blocked record must commit nothing")];
  }
  return [];
}

function newCommitProblem(rule: string): string {
  return `${rule}, but the step made a new commit`;
}

export interface CommittedBranch {
  repo: string;
  branch: string;
  sha: string;
}

export const blockerKinds = [
  "gated-action",
  "spec-ambiguity",
  "denied-tool",
] as const;

export interface Blocker {
  kind: (typeof blockerKinds)[number];
  detail: string;
  recommendation: string;
}

export interface Handoff {
  conclusion: string;
  filesToOpen: { path: string; lines: string }[];
  ruledOut: string[];
  filesChanged: string[];
  stillFailing: string[];
  // Set when less than half the ticket is done: the remaining work, which the developer splits the ticket into.
  proposedSplit?: ProposedSlice[];
}

export interface ProposedSlice {
  delivers: string;
  files: string[];
}

// A piece spec's research ticket: ready once its comment is written, unposted, in the step's scratch folder.
export type ResearchRecord =
  ReadyResearchRecord | BlockedResearchRecord | HandoffResearchRecord;

export interface ReadyResearchRecord {
  status: "ready";
  commentPath: string;
  // The source texts `verify:quotes` reads.
  textsFolder: string;
  counts: ResearchCounts;
  // Proposed only; the step applies none.
  outlineEdits: OutlineEdit[];
  unverified: UnverifiedItem[];
  blockers: Blocker[];
}

export interface BlockedResearchRecord {
  status: "blocked";
  blockers: Blocker[];
}

export interface HandoffResearchRecord {
  status: "handoff";
  blockers: Blocker[];
  handoff: ResearchHandoff;
}

// The claims the research pass supported, rewrote and moved to Unverified.
export interface ResearchCounts {
  supported: number;
  rewritten: number;
  unverified: number;
}

export interface OutlineEdit {
  section: string;
  edit: string;
  reason: string;
}

export interface UnverifiedItem {
  fact: string;
  reason: string;
  // Set when the spec's Facts field names the fact.
  isWanted: boolean;
}

export interface ResearchHandoff {
  conclusion: string;
  sourcesDone: string[];
  sourcesLeft: string[];
}

export interface ReviewFinding {
  axis: Axis;
  where: string;
  claim: string;
  suggestedVerdict: Verdict;
  reason: string;
}

// A run state saved before #362 holds each finding as one prose string.
export type Finding = ReviewFinding | string;

export interface ReviewRecord {
  // Each reviewer's findings in its own order, standards then spec; empty when it found nothing.
  findings: ReviewFinding[];
}

// docs/agents/verdicts.md defines each reason.
export const dismissReasons = [
  "false-positive",
  "covered-later",
  "kept",
  "tooling-enforced",
  "serves-spec",
] as const;
export const proposeReasons = ["decision", "ticket"] as const;

export type DismissReason = (typeof dismissReasons)[number];
export type ProposeReason = (typeof proposeReasons)[number];

// Named later tickets, each `<repo>#<n>`, plus their downstream; or the whole spec.
export type HaltScope = "spec" | string[];

// What the schema guarantees; resolveRecordProblems() checks which fields each verdict needs.
export interface ResolveRecord {
  // The finding's number in the review's list, from 1.
  finding: number;
  axis: Axis;
  // The reviewer's, set by the runner; absent for a finding saved before #362.
  suggestedVerdict?: Verdict;
  where: string;
  claim: string;
  quote?: string;
  rule?: string;
  verdict: Verdict;
  reason?: string;
  evidence: string;
  coveredBy?: string;
  haltScope?: HaltScope;
  recommendation?: string;
  draftIssueTitle?: string;
  draftKeepReason?: string;
}

export interface Gap {
  // What the spec asked for, by its story number or section.
  ask: string;
  evidence: string;
  recommendation: string;
  // The drafted follow-up; the runner never files it.
  draftIssueTitle: string;
}

export interface GapCheckRecord {
  gaps: Gap[];
}

export interface MergeMasterRecord {
  summary: string;
  files: string[];
  // Each file the step couldn't resolve and the question it raises.
  unsure?: string;
}

// A Halt with no scope blocks the whole spec: the safe default when the resolver is unsure.
export function haltScopeOf(record: ResolveRecord): HaltScope {
  return record.haltScope ?? "spec";
}

const caughtLabels = {
  fix: "Fixed",
  propose: "Proposed",
  halt: "Halted",
} as const satisfies Partial<Record<Verdict, string>>;

// The outcome row's text; undefined when the review kept nothing.
export function whatReviewCaughtOf(
  records: ResolveRecord[],
): string | undefined {
  const groups = Object.entries(caughtLabels).flatMap(([verdict, label]) => {
    const caught = records
      .filter((record) => record.verdict === verdict)
      .map(({ claim, where }) => `${claim} (${where})`);
    return caught.length === 0 ? [] : [`${label}: ${caught.join("; ")}.`];
  });
  return groups.length === 0 ? undefined : groups.join(" ");
}

// A `<repo>#<n>` reference, as `coveredBy` names its ticket.
export function issueRefOf(text: string | undefined): IssueRef | undefined {
  const match = /^([\w.-]+)#(\d+)$/.exec(text?.trim() ?? "");
  if (match === null) return undefined;
  const [, repo = "", number = ""] = match;
  return { repo, number: Number(number) };
}
