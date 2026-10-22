// The run's state and shapes: the Run, each ticket's TicketState and the step it reached, a ticket's TicketRun,
// and the Waits that keep a ticket from launching, plus the module functions more than one SpecRun collaborator calls:
// raising and delivering Halts, a ticket's state, step-record reads, and the run's end and wait messages.
// A declaration here is exported only when another file uses it; a function with one caller sits below that caller's class instead.
// The class that saves this state is SpecRunBase.ts; the coordinator callers build is ../SpecRun.ts.

import { execFile } from "node:child_process";
import { writeFileSync } from "node:fs";
import { promisify } from "node:util";

import type { Pair, StepRequest, StepResult } from "../AgentStep.ts";
import { type ReviewFacts } from "../FactsFile.ts";
import { messageOf, outputTailOf } from "../failureText.ts";
import { type TriageRecord, whatReviewCaughtOf } from "../findingTriage.ts";
import {
  failureAnswerOf,
  failureOptions,
  type Halt,
  type HaltDraft,
  isStopSpecAnswer,
  sessionHaltIdOf,
  shortRefOf,
  type StepFailure,
} from "../halts.ts";
import { type Handoff, type ImplementRecord } from "../implementStep.ts";
import { type BodyAuthorship } from "../IssueReader.ts";
import {
  issueLabelOf,
  type IssueRef,
  type LeaseHolder,
  type Workspace,
} from "../IssueWorkspaces.ts";
import type { Command, RunKnobs } from "../runKnobs.ts";
import { SchemaFailure } from "../SchemaFailure.ts";
import { type Target, targetLineShapes, targetsOf } from "../ticketTargets.ts";
import { type StepAgent, type StepSession } from "../transcriptFacts.ts";
import { stopOutcomes, UnhandledStop } from "../UnhandledStop.ts";

const execFileAsync = promisify(execFile);

export const readyLabel = "ready-for-agent";

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
  kind: "finished" | "refused" | "stopped";
  landed: IssueRef[];
  message: string;
}

export interface ReviewOptions {
  // The interactive session's, which may hold the workspace's lease.
  holder?: LeaseHolder;
}

export interface ReviewResult {
  kind: "reviewed" | "halted" | "stopped" | "refused";
  message: string;
  // Each Halt comment the review posted on the spec, for the session to print.
  halts: string[];
}

export type TicketStep =
  | "implement"
  | "review"
  | "triage"
  | "fix"
  | "checks"
  | "halted"
  | "resume"
  | "wrap-up"
  | "landed"
  | "stopped";

export type Fixer = "implementer" | "triage";

// Each worktree's clone path to its HEAD.
export type Heads = Record<string, string>;

export interface TicketState {
  step: TicketStep;
  record?: ImplementRecord;
  // The last implement step's own peak, never a sum across handoffs; picks the fixer and whether a resume continues its session.
  implementPeak?: number;
  // The implementer's latest session, a fix step it ran included.
  implementerSession?: string;
  findings?: string[];
  // A fixer's give-ups are rewritten in place as Halts or Proposals.
  triage?: TriageRecord[];
  // Set once a fixer fixed a finding.
  fixer?: Fixer;
  // The heads before the fix step, which a killed fixer or a rerun resets to.
  fixBase?: Heads;
  sessions: StepSession[];
  configFolder?: string;
  stop?: string;
  // Set while a step runs, so a rerun after the process died takes the step as crashed.
  isStepStarted?: boolean;
  // Retries taken, by the step that crashed; cleared when a Failure Halt is answered.
  crashes?: Partial<Record<TicketStep, number>>;
  // Kept apart from crashes.checks, so a crash in the red-checks resume doesn't spend the red-checks retry.
  redCheckResumes?: number;
  redChecksLogPath?: string;
  // Counts the wrap-up conflict's merge-master resumes; cleared when a Failure Halt is answered.
  conflictResumes?: number;
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
  // Every ticket's, answered ones included, in the order raised; absent from a state file written before Halts.
  halts?: Halt[];
}

export interface Run {
  spec: TrackedIssue;
  tickets: IssueRef[];
  isTicketless: boolean;
  state: RunState;
  landed: IssueRef[];
  warnings: Set<RunWarning>;
  // Tickets whose Failure Halt this run was answered `skip`; a later run retries them.
  skipped: Set<string>;
  // The distinct tickets whose Failure Halts came in a row; a landing clears it.
  failureStreak: string[];
  // One ticket's review outside a run; a flag, not a strategy, as it differs from a run at only a handful of checks.
  sessionReview?: SessionReview;
}

interface SessionReview {
  // The ticket's session Halts already on the spec, which this review numbers on from.
  earlierHalts: number;
  postedHalts: string[];
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

export type TicketOutcome = "landed" | "stopped" | "leased" | "halted";

export interface Wait {
  ticket: IssueRef;
  reason: WaitReason;
  text: string;
  holder?: LeaseHolder;
}

type WaitReason =
  | "leased"
  | "halted"
  | "stop-spec"
  | "stopped"
  | "skipped"
  | "developer"
  | "blocked";

interface DownstreamSearch {
  run: Run;
  blockersOf: Map<string, string[]>;
  ticket: string;
}

export interface RanStep {
  result: StepResult;
  logPath: string;
}

export interface LaunchedStep {
  record: unknown;
  logPath: string;
  peakContext: number | undefined;
}

export type StepLaunch = Pick<StepRequest, "prompt" | "jsonSchema"> &
  Partial<
    Pick<
      StepRequest,
      "pair" | "targets" | "resumeSessionId" | "liveCeiling" | "maxTurns"
    >
  >;

export type Crash = Pick<StepFailure, "detail" | "logPath">;

export function isFix({ verdict }: TriageRecord): boolean {
  return verdict === "fix";
}

// Saved with the step's own state when it advances, so a rerun of the step never raises them twice.
export function raiseHalts(
  run: Run,
  { ticket, drafts }: { ticket: IssueRef; drafts: HaltDraft[] },
): void {
  run.state.halts ??= [];
  const { halts } = run.state;
  const { sessionReview } = run;
  drafts.forEach((draft) => {
    const index = halts.length + 1;
    halts.push({
      ...draft,
      id:
        sessionReview === undefined
          ? `H${index}`
          : sessionHaltIdOf(ticket, sessionReview.earlierHalts + index),
      ticket,
      isPosted: false,
      isDelivered: false,
      ignoredReplies: [],
    });
  });
}

export function haltsOf(run: Run): Halt[] {
  return run.state.halts ?? [];
}

export function haltsOfTicket(run: Run, ticket: IssueRef): Halt[] {
  return haltsOf(run).filter((halt) => isSameIssue(halt.ticket, ticket));
}

export function isAuthorshipHalt({ bodyHash }: Halt): boolean {
  return bodyHash !== undefined;
}

export function isStopSpec({ answer }: Halt): boolean {
  return answer !== undefined && isStopSpecAnswer(answer);
}

export function isSameIssue(first: IssueRef, second: IssueRef): boolean {
  return shortRefOf(first) === shortRefOf(second);
}

export function undeliveredHaltsOf(run: Run, ticket: IssueRef): Halt[] {
  return haltsOfTicket(run, ticket).filter(({ isDelivered }) => !isDelivered);
}

export function idListOf(halts: Halt[]): string {
  return halts.map(({ id }) => id).join(", ");
}

// Marks answered Failure Halts delivered, clears the retry counts and acts on the latest answer; a `skip` read on a later run is a retry.
export function deliverFailureHalts(
  run: Run,
  { ticket, extraTurns }: { ticket: IssueRef; extraTurns: number },
): TicketStep | undefined {
  const state = ticketStateOf(run, ticket);
  const failures = undeliveredHaltsOf(run, ticket).filter(isTicketFailureHalt);
  const latest = failures.at(-1);
  if (latest?.answer === undefined) return undefined;
  failures.forEach((halt) => {
    halt.isDelivered = true;
  });
  state.crashes = undefined;
  state.redCheckResumes = undefined;
  state.redChecksLogPath = undefined;
  state.conflictResumes = undefined;
  state.continuation = undefined;
  state.guidance = undefined;
  const answer = failureAnswerOf(latest, latest.answer);
  // A continuation another Halt never offered would resume a session with nothing to continue.
  if (
    answer.kind === "retry-record" &&
    isOffered(latest, failureOptions.retryRecord)
  ) {
    state.continuation = { kind: "record" };
  }
  if (answer.kind === "more-turns" && isOffered(latest, "`resume +")) {
    state.continuation = { kind: "turns", turns: answer.turns ?? extraTurns };
  }
  if (
    answer.kind === "more-handoffs" &&
    isOffered(latest, failureOptions.moreHandoffs)
  ) {
    state.extraHandoffs = (state.extraHandoffs ?? 0) + 1;
  }
  if (answer.kind === "rerun") state.pair = answer.pair;
  if (answer.kind === "guidance") state.guidance = answer.text;
  return latest.failedStep;
}

function isTicketFailureHalt(
  halt: Halt,
): halt is Halt & { failedStep: TicketStep } {
  return (
    halt.kind === "failure" &&
    halt.failedStep !== undefined &&
    !isGapCheckHalt(halt)
  );
}

function isOffered(halt: Halt, option: string): boolean {
  return halt.options.some((offered) => offered.startsWith(option));
}

export function isGapCheckHalt({ failedStep }: Halt): boolean {
  return failedStep === "gap-check";
}

// The tickets downstream of one, each `<repo>#<n>`, through the blocking graph.
export function downstreamIn({
  run,
  blockersOf,
  ticket,
}: DownstreamSearch): string[] {
  const downstream: string[] = [];
  let frontier = [ticket];
  while (frontier.length > 0) {
    const next = run.tickets.map(shortRefOf).filter((label) => {
      if (label === ticket || downstream.includes(label)) return false;
      const blockers = blockersOf.get(label) ?? [];
      return blockers.some((blocker) => frontier.includes(blocker));
    });
    downstream.push(...next);
    frontier = next;
  }
  return downstream;
}

export function isSameHeads(first: Heads, second: Heads): boolean {
  return JSON.stringify(first) === JSON.stringify(second);
}

// A session review has no implement record, so its workspace's branched repos stand in.
export function branchedReposOf({ workspace, state }: TicketRun): string[] {
  return (
    state.record?.branches.map(({ repo }) => repo) ?? workspace.branchedRepos
  );
}

// Absent from a state file written before Halts, where the last implement session is the implementer's.
export function implementerSessionOf(state: TicketState): string | undefined {
  return state.implementerSession ?? lastSessionOf(state, "implement");
}

export function lastSessionOf(
  state: TicketState,
  agent: StepAgent,
): string | undefined {
  return state.sessions.findLast((session) => session.agent === agent)
    ?.sessionId;
}

// A live-ceiling kill is the fixer's crossing, whatever its subtype.
export function isTurnCapped(result: StepResult): boolean {
  return result.exitSubtype === "error_max_turns" && !result.hasCrossedCeiling;
}

export function turnCapDetailOf(
  step: StepAgent | typeof gapCheckLabel,
  turns: number,
): string {
  return `The ${step} step hit its ${turns}-turn cap.`;
}

// Review and triage edit nothing, so there is no work of theirs to set aside.
export function isSnapshotted(step: TicketStep): boolean {
  return step !== "review" && step !== "triage";
}

// After a handoff the implement step builds on the uncommitted work, so a snapshot saves it without a reset.
export function isTreeKept({ step, latestHandoff }: TicketState): boolean {
  const isImplement = step === "implement" || step === "resume";
  return isImplement && latestHandoff !== undefined;
}

// Writes the raw output beside the step's log, so the Failure Halt can link it.
export function schemaFailureOf(
  logPath: string,
  { problems, output }: { problems: string[]; output: unknown },
): SchemaFailure {
  const outputPath = logPath.replace(/\.jsonl$/, ".output.txt");
  const raw =
    typeof output === "string" ? output : JSON.stringify(output, undefined, 2);
  writeFileSync(outputPath, raw);
  return new SchemaFailure(
    `${problems.join("; ")}\n\nRaw output: \`${outputPath}\``,
    logPath,
  );
}

export function liveCeilingPhraseOf({ liveCeiling }: RunKnobs): string {
  return `the live ceiling of ${liveCeiling}`;
}

export function launchedOf(
  agent: StepAgent,
  { result, logPath }: RanStep,
): LaunchedStep {
  const record = recordOf(agent, result, logPath);
  return { record, logPath, peakContext: result.peakContext };
}

export function recordOf(
  step: string,
  result: StepResult,
  logPath: string,
): unknown {
  const { output } = result;
  if (output.status === "schemaFailure") {
    throw schemaFailureOf(logPath, {
      problems: output.problems,
      output: output.rawOutput,
    });
  }
  if (result.errorText !== undefined) {
    throw new UnhandledStop(
      "step-error",
      `The ${step} step ended on an error: ${result.errorText}`,
      logPath,
    );
  }
  if (result.exitSubtype !== "success" || output.status !== "valid") {
    throw new UnhandledStop(
      "step-error",
      `The ${step} step ended ${result.exitSubtype ?? "without a result"}.`,
      logPath,
    );
  }
  return output.record;
}

export function reviewFactsOf({
  fixer,
  triage = [],
}: TicketState): ReviewFacts {
  return {
    reviewFixes: fixer ?? "none",
    whatReviewCaught: whatReviewCaughtOf(triage),
    proposals: triage.filter(({ verdict }) => verdict === "propose").length,
  };
}

export function stoppedOnTextOf({
  outcome,
  message,
  logPath,
}: UnhandledStop): string {
  return `stopped on ${stopOutcomes[outcome]}: ${message} Log: \`${logPath}\``;
}

export function ticketStateOf(run: Run, ticket: IssueRef): TicketState {
  const key = issueLabelOf(ticket);
  run.state.tickets[key] ??= { step: "implement", sessions: [] };
  return run.state.tickets[key];
}

export function targetsRefusalOf(
  run: Run,
  launchable: TrackedIssue[],
): string | undefined {
  const checked = run.isTicketless ? [run.spec] : launchable;
  const offenders = checked.flatMap(({ issue, body }) => {
    const reading = targetsOf(body);
    if (reading.status === "valid") return [];
    return [`${issueLabelOf(issue)} (\`${reading.line}\`)`];
  });
  if (offenders.length === 0) return undefined;
  return `Each ## Targets line must be ${targetLineShapes}; malformed in ${offenders.join(", ")}.`;
}

export function targetsAtLaunchOf(
  ticket: TrackedIssue,
  logPath: string,
): Target[] {
  const reading = targetsOf(ticket.body);
  if (reading.status === "valid") return reading.targets;
  throw new UnhandledStop(
    "targets",
    `The ## Targets section changed after preflight: \`${reading.line}\` isn't ${targetLineShapes}.`,
    logPath,
  );
}

export function isLaunchable(ticket: TrackedIssue): boolean {
  return ticket.isOpen && ticket.labels.includes(readyLabel);
}

// The command's output tail when it fails, undefined when it passes.
export async function runCommand(
  command: Command,
  cwd: string,
): Promise<string | undefined> {
  const [file, ...args] = command;
  try {
    await execFileAsync(file, args, { cwd, maxBuffer: 64 * 1024 * 1024 });
    return undefined;
  } catch (error) {
    return outputTailOf(error) || messageOf(error);
  }
}

export function onlyDeveloperEditsTextOf(
  developer: string,
  bodies: string,
): string {
  return `Only ${developer} may write or edit ${bodies}`;
}

export function rerunCommandOf(
  owner: string,
  { repo, number }: IssueRef,
): string {
  return `npm run runner -- ${owner}/${repo} ${number}`;
}

export function openHaltsOf(run: Run): Halt[] {
  return haltsOf(run).filter(({ answer }) => answer === undefined);
}

export function waitsTextOf(waits: Wait[]): string {
  return waits.map(({ text }) => text).join("; ");
}

export function landedTextOf(landed: IssueRef[]): string {
  if (landed.length === 0) return "landed nothing";
  return `landed ${landed.map(issueLabelOf).join(", ")}`;
}
