// The run's state and shapes: the Run, each ticket's TicketState and the step it reached, a ticket's TicketRun,
// and the Waits that keep a ticket from launching, plus the helper bundles more than one SpecRun collaborator calls:
// runTickets for a ticket's state, ticketLaunch for its targets and launchability, and memberBlocking for a Batch member's blockers.
// A declaration here is exported only when another file uses it; a function with one caller sits below that caller's class instead.
// The class that saves this state is SpecRunBase.ts; the coordinator callers build is ../SpecRun.ts; the Halt helpers are runState/runHalts.ts;
// the session and step-record helpers are runState/ticketSteps.ts; the end, wait and refusal wording is runState/runText.ts;
// the state file and progress log paths are runState/statePaths.ts; the command runner is ../runCommand.ts;
// the issue-set helpers sit beside issueRef.isSame in ../IssueWorkspaces/workspaceTypes.ts.

import type {
  Pair,
  StepRequest,
  StepResult,
  UsageReading,
} from "../AgentStep.ts";
import { type Halt, type StepFailure } from "../halts.ts";
import { type BodyAuthorship } from "../IssueReader.ts";
import {
  type IssueRef,
  issueRef,
  type LeaseHolder,
  type Workspace,
} from "../IssueWorkspaces.ts";
import type { UndecidedCount } from "../reviewList.ts";
import {
  type Finding,
  type Handoff,
  type ImplementRecord,
  type MergeMasterRecord,
  type ResolveRecord,
} from "../stepRecords.ts";
import { type Target, targetLineShapes, targetsOf } from "../ticketTargets.ts";
import { type RecordedSession, type StepSession } from "../transcriptFacts.ts";
import { UnhandledStop } from "../UnhandledStop.ts";
import { runText } from "./runState/runText.ts";

export const readyLabel = "ready-for-agent";
export const interactiveLabel = "ready-for-interactive";

export const gapCheckLabel = "gap check";

export interface TrackedIssue extends BodyAuthorship {
  issue: IssueRef;
  title: string;
  body: string;
  isOpen: boolean;
  labels: string[];
  url: string;
}

export interface IssueComment {
  id: string;
  author: string;
  body: string;
}

export interface RunResult {
  kind: "finished" | "refused" | "stopped" | "restarting";
  landed: IssueRef[];
  message: string;
}

// What an issue leaves to judge: its undecided items, or none and so its close.
export type Judgement = UndecidedCount | "ready to close";

// A run's member issues in typed order; non-empty, so the run always has a first member to tell what concerns it as a whole.
export type MemberList = [IssueRef, ...IssueRef[]];

// A Batch's members and those of them finished with nothing waiting, which no longer block.
export interface BatchView {
  memberIssues: MemberList;
  landedMembers: IssueRef[];
}

export interface ReviewOptions {
  // The interactive session's, which may hold the workspace's lease.
  holder?: LeaseHolder;
}

export interface ResolveOptions extends ReviewOptions {
  // The session's resolve output, `{ records }`, unchecked.
  output: unknown;
}

export interface ReviewResult {
  // `findings`: the session resolves them itself and hands its records to `resolve`.
  kind: "reviewed" | "findings" | "halted" | "stopped" | "refused";
  message: string;
  // Each Halt comment the review posted on the spec, for the session to print.
  halts: string[];
  // The run's review-list rendering, printed as well as posted; absent when resolve kept no records.
  reviewList?: string;
  // The numbered findings, each with its axis and suggested verdict, when the session resolves them.
  findings?: string;
}

export type TicketStep =
  | "implement"
  | "review"
  | "resolve"
  | "checks"
  | "halted"
  | "resume"
  | "wrap-up"
  | "landed"
  | "stopped";

export type Resolver = "implementer" | "fresh";

// Each worktree's clone path to its HEAD.
export type Heads = Record<string, string>;

// Optional, as a state saved before #367 has neither.
export type TicketSession = StepSession &
  Partial<Pick<RecordedSession, "account" | "configFolder">>;

export interface TicketState {
  step: TicketStep;
  record?: ImplementRecord;
  // The last implement step's own peak, never a sum across handoffs; picks the resolver and whether a resume continues its session.
  implementPeak?: number;
  // The implementer's latest session, a resolve it ran included.
  implementerSession?: string;
  findings?: Finding[];
  resolveRecords?: ResolveRecord[];
  // Set once a resolver fixed a finding.
  resolver?: Resolver;
  // The fresh resolver's latest session, which a red-checks resume continues.
  resolverSession?: string;
  // The heads before the resolve step, which a killed resolver or a rerun resets to.
  resolveBase?: Heads;
  sessions: TicketSession[];
  stop?: string;
  // Set while a step runs, so a rerun after the process died takes the step as crashed.
  isStepStarted?: boolean;
  // Retries taken, by the step that crashed; cleared when a Failure Halt is answered.
  crashes?: Partial<Record<TicketStep, number>>;
  // Kept apart from crashes.checks, so a crash in the red-checks resume doesn't spend the red-checks retry.
  redCheckResumes?: number;
  // Relaunches of a step a usage limit cut off; never cleared, so the outcome row counts every one.
  limitResumes?: number;
  redChecksLogPath?: string;
  // Counts the wrap-up conflict's merge-master resumes; cleared when a Failure Halt is answered.
  conflictResumes?: number;
  // The latest merge-master record, shown on the review list once the ticket lands.
  mergeMasterRecord?: MergeMasterRecord;
  // Why a merge-master resume kept no record, shown in the record's place once the ticket lands.
  unrecordedMerge?: string;
  // The heads before the latest implement step, which a continued session's record is checked against.
  implementBase?: Heads;
  // Kept across a rerun, so the step after a handoff starts from it; cleared by any other implement record.
  latestHandoff?: Handoff;
  // Numbers each handoff's backup branch, and counts toward the handoff cap.
  handoffCount?: number;
  // Added by `continue +1 handoff` answers, on top of the handoffsPerTicket knob.
  extraHandoffs?: number;
  // The handoff whose proposed split a Halt already carried, so a rerun never raises it again.
  splitHaltedHandoff?: number;
  // Set by a Failure Halt's answer, so a rerun acts on it.
  pair?: Pair;
  guidance?: string;
  continuation?: Continuation;
  // Set once a landed ticket's review list and covered-later notes are posted, or found to need none.
  isReviewListPosted?: boolean;
}

export type Continuation =
  { kind: "record" } | { kind: "turns"; turns: number };

export interface RunState {
  tickets: Record<string, TicketState>;
  // Rewritten at each run start, a relaunch's included, for the Run board's tickets left; absent from a state file written before #673.
  ticketLabels?: string[];
  // Every ticket's, answered ones included, in the order raised; absent from a state file written before Halts.
  halts?: Halt[];
  // Set by a Restart and taken by its relaunch, which carries on its landings.
  restart?: Restart;
}

export interface Restart {
  landed: IssueRef[];
  // Set when the member ended before the Restart, so its relaunch doesn't announce that end again; absent from an older runner's restart.
  end?: MemberEnd;
}

export interface MemberEnd {
  result: RunResult;
  // Finished with nothing left waiting.
  isLanded: boolean;
}

export interface Run {
  spec: TrackedIssue;
  tickets: IssueRef[];
  isStandalone: boolean;
  state: RunState;
  landed: IssueRef[];
  warnings: Set<RunWarning>;
  // Tickets whose Failure Halt this run was answered `skip`; a later run retries them.
  skipped: Set<string>;
  // The distinct tickets whose Failure Halts came in a row; a landing clears it.
  failureStreak: string[];
  // By account, the last usage reading a step's own stream gave, which the limit guard weighs against cswap's; held in memory only.
  streamUsage: Map<number, UsageReading>;
  // A member's end is then a member-ended line unless it finished, and only the Batch's end says what's left to judge.
  isBatchMember?: boolean;
  // One ticket's review outside a run; a flag, not a strategy, as it differs from a run at only a handful of checks.
  sessionReview?: SessionReview;
}

interface SessionReview {
  // The ticket's session Halts already on the spec, which this review numbers on from.
  earlierHalts: number;
  postedHalts: string[];
  resolvesItself: boolean;
}

// Each pushed at most once per run.
export type RunWarning = "missing-reading" | "unrecognised-limit-error";

export interface LandingTicket {
  run: Run;
  ticket: TrackedIssue;
  pair: Pair;
  state: TicketState;
}

export interface TicketRun extends LandingTicket {
  workspace: Workspace;
  targets: Target[];
}

export type TicketOutcome = "landed" | "leased" | "halted";

export interface Wait {
  ticket: IssueRef;
  reason: WaitReason;
  text: string;
  holder?: LeaseHolder;
}

// `member-blocked` is a Batch member waiting on another member to land.
type WaitReason =
  | "leased"
  | "halted"
  | "stopped"
  | "skipped"
  | "developer"
  | "blocked"
  | "member-blocked";

export interface RanStep {
  result: StepResult;
  logPath: string;
}

export interface LaunchedStep {
  record: unknown;
  logPath: string;
  peakContext: number | undefined;
  deniedTools: string[];
}

export type StepLaunch = Pick<StepRequest, "prompt" | "jsonSchema"> &
  Partial<
    Pick<
      StepRequest,
      "pair" | "targets" | "resumeSessionId" | "liveCeiling" | "maxTurns"
    >
  > & { beforeCrashRetry?(): Promise<void> };

// A spec-level step's request before the launcher picks its account.
export type SpecStepRequest = Omit<StepRequest, "account">;

export type Crash = Pick<StepFailure, "detail" | "logPath">;

export const runTickets = {
  stateOf(run: Run, ticket: IssueRef): TicketState {
    const key = issueRef.labelOf(ticket);
    run.state.tickets[key] ??= { step: "implement", sessions: [] };
    return run.state.tickets[key];
  },

  isLanded(run: Run, ticket: IssueRef): boolean {
    return run.state.tickets[issueRef.labelOf(ticket)]?.step === "landed";
  },
};

export const ticketLaunch = {
  targetsRefusalOf(run: Run, launchable: TrackedIssue[]): string | undefined {
    const checked = run.isStandalone ? [run.spec] : launchable;
    const offenders = checked.flatMap(({ issue, body }) => {
      const reading = targetsOf(body);
      if (reading.status === "valid") return [];
      return [`${issueRef.labelOf(issue)} (\`${reading.line}\`)`];
    });
    if (offenders.length === 0) return undefined;
    return `Each ## Targets line must be ${targetLineShapes}; malformed in ${offenders.join(", ")}.`;
  },

  validTargetsOf(ticket: TrackedIssue, logPath: string): Target[] {
    const reading = targetsOf(ticket.body);
    if (reading.status === "valid") return reading.targets;
    throw new UnhandledStop(
      "targets",
      `The ## Targets section changed after preflight: \`${reading.line}\` isn't ${targetLineShapes}.`,
      logPath,
    );
  },

  isReady(ticket: TrackedIssue): boolean {
    return ticket.isOpen && ticket.labels.includes(readyLabel);
  },
};

export const memberBlocking = {
  // The Batch's members among a member's open blockers that haven't landed; a landed one counts as cleared though GitHub may show it open.
  unlandedOf(
    open: IssueRef[],
    { memberIssues, landedMembers }: BatchView,
  ): IssueRef[] {
    return issueRef.outside({
      issues: memberIssues.filter((each) => issueRef.isAmong(each, open)),
      excluded: landedMembers,
    });
  },

  // The wait the run loop and status both show for a member held by blocker members.
  waitOf(member: IssueRef, blockers: IssueRef[]): Wait {
    const text = runText.waitsToLand(
      issueRef.labelOf(member),
      blockers.map(issueRef.labelOf),
    );
    return { ticket: member, reason: "member-blocked", text };
  },
};
