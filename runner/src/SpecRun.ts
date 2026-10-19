// The run loop: takes one spec's tickets, one at a time in blocking-graph order, through implement, review, finding triage,
// fix, checks and wrap-up in each ticket's issue workspace, and never closes the spec. Preflight refuses or Stops a run first;
// red checks on a red master Stop the run.
// A blocker, a Halt verdict or a fixer's give-up is a Halt: posted once the ticket's other work is committed, it holds the
// tickets in its scope, and the ticket resumes once every one of its Halts is answered (halts.ts).
// Any outcome a later ticket will handle (red checks, step errors, schema failures) is an UnhandledStop.
// The run holds the lease on the workspace of the ticket it's working; a ticket another holder has leased waits.
// GitHub and git hold what's durable; a per-spec state file holds the step each ticket reached, so a rerun resumes there.
// Steps launch through AgentStep.ts; prompts are implementStep.ts, reviewStep.ts, findingTriage.ts and fixStep.ts;
// landing is WrapUp.ts; knobs are runKnobs.ts; the review list and gap check are reviewList.ts and gapCheck.ts.

import { execFile } from "node:child_process";
import {
  appendFileSync,
  copyFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";
import { promisify } from "node:util";

import type { AgentStep, Pair, StepRequest, StepResult } from "./AgentStep.ts";
import { commandLabelOf, messageOf, outputTailOf } from "./failureText.ts";
import {
  triageOutputSchema,
  triagePrompt,
  type TriageRecord,
  triageRecordProblems,
  triageRecordsOf,
  triageRetryPrompt,
} from "./findingTriage.ts";
import {
  type FixOutcome,
  fixOutcomesOf,
  fixOutputSchema,
  fixPrompt,
  fixRecordProblems,
  type GaveUpOutcome,
  giveUpRecordOf,
} from "./fixStep.ts";
import {
  gapCheckOutputSchema,
  gapCheckPrompt,
  gapCheckRecordOf,
  type GapCheckTicket,
} from "./gapCheck.ts";
import {
  currentBranchOf,
  dirtyReposOf,
  git,
  type RepoWorktree,
  worktreeStateOf,
} from "./git.ts";
import {
  answeredNoteOf,
  blockerHaltOf,
  freshResumeSection,
  type Halt,
  haltCommentOf,
  type HaltDraft,
  haltKindLabelOf,
  haltNameOf,
  haltNoticeOf,
  type HaltPost,
  ignoredNoteOf,
  isRunnersComment,
  isStopSpecAnswer,
  repliesTo,
  resumePrompt,
  runnerMark,
  shortRefOf,
  triageHaltOf,
} from "./halts.ts";
import {
  type Blocker,
  implementOutputSchema,
  implementPrompt,
  type ImplementRecord,
  implementRecordOf,
  implementRecordProblems,
} from "./implementStep.ts";
import { type BodyAuthorship, untrustedBodyReasonOf } from "./IssueReader.ts";
import {
  fileStemOf,
  holderLabelOf,
  isSameHolder,
  issueLabelOf,
  type IssueRef,
  IssueWorkspaces,
  type IssueWorkspacesConfig,
  type LeaseHolder,
  otherLiveHolderOf,
  type Workspace,
} from "./IssueWorkspaces.ts";
import { LeaseHeld } from "./LeaseHeld.ts";
import {
  type AccountReading,
  type AccountUsage,
  decideStep,
  defaultLimitGuardKnobs,
  type LimitGuardKnobs,
  type UsageReader,
} from "./limitGuard.ts";
import { pairLabelOf, pairOf, strongerPairOf } from "./modelFit.ts";
import type { Notices } from "./Notices.ts";
import {
  coveredLaterNotesOf,
  gapCheckListOf,
  gapCheckSubject,
  reviewListMarkOf,
  type ReviewListSubject,
  ticketPushOf,
  ticketReviewListOf,
  undecidedCountOf,
  undecidedLineOf,
} from "./reviewList.ts";
import {
  reviewPrompt,
  type ReviewRecord,
  reviewRecordSchema,
} from "./reviewStep.ts";
import type { Command, RunKnobs } from "./runKnobs.ts";
import { RunStop } from "./RunStop.ts";
import { sleep } from "./sleep.ts";
import { TicketHalted } from "./TicketHalted.ts";
import { type Target, targetLineShapes, targetsOf } from "./ticketTargets.ts";
import {
  type LimitReading,
  type LimitReadings,
  percentOf,
  type StepAgent,
  type StepSession,
} from "./transcriptFacts.ts";
import { stopOutcomes, UnhandledStop } from "./UnhandledStop.ts";
import {
  WrapUp,
  type WrapUpFacts,
  type WrapUpGitHub,
  type WrapUpKnobs,
} from "./WrapUp.ts";

const execFileAsync = promisify(execFile);

const readyLabel = "ready-for-agent";
const runHolder: LeaseHolder = { kind: "run", pid: process.pid };

export interface TrackedIssue extends BodyAuthorship {
  issue: IssueRef;
  title: string;
  body: string;
  isOpen: boolean;
  labels: string[];
  url: string;
}

export interface RunGitHub extends WrapUpGitHub {
  issueOf(issue: IssueRef): Promise<TrackedIssue>;
  // In sub-issue order.
  subIssuesOf(issue: IssueRef): Promise<IssueRef[]>;
  // The issues still open among those natively marked as blocking it.
  openBlockersOf(issue: IssueRef): Promise<IssueRef[]>;
  comment(issue: IssueRef, body: string): Promise<void>;
  // Oldest first.
  authoredCommentsOf(issue: IssueRef): Promise<IssueComment[]>;
}

export interface IssueComment {
  id: string;
  author: string;
  body: string;
}

export interface Clock {
  now(): Date;
}

export interface SpecRunConfig {
  knobs: RunKnobs;
  agentStep: AgentStep;
  github: RunGitHub;
  notices: Notices;
  usageReader: UsageReader;
  clock: Clock;
  githubOwner: string;
  // The one GitHub login whose bodies pass the authorship refusal.
  developer: string;
  primaryRoot: string;
  workspaceFolder: string;
  symlinkedFiles: string[];
  installDependencies(workspaceRoot: string): Promise<void>;
  // The command an implement step runs to promote a repo, taking the repo as its last argument.
  promoteCommandOf(issue: IssueRef): string;
  // Relative to the root repo.
  outcomeFolder: string;
  // Holds the run state, progress log and step logs, and the wrap-up's facts and progress files; gitignored.
  stateFolder: string;
  wrapUpKnobs?: Partial<WrapUpKnobs>;
  limitGuardKnobs?: Partial<LimitGuardKnobs>;
  sleep?(ms: number): Promise<void>;
  log?(line: string): void;
}

export interface RunResult {
  kind: "finished" | "refused" | "stopped";
  landed: IssueRef[];
  message: string;
}

type TicketStep =
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

type Fixer = "implementer" | "triage";

// Each worktree's clone path to its HEAD.
type Heads = Record<string, string>;

interface CloneWorktree {
  repo: string;
  clonePath: string;
  worktree: string;
}

interface HeadsAndDirtyRepos {
  heads: Heads;
  dirtyRepos: string[];
}

type TimedStep =
  Exclude<TicketStep, "halted" | "landed" | "stopped"> | "workspace";

interface TicketState {
  step: TicketStep;
  record?: ImplementRecord;
  // The implementer's peak context, which picks the fixer and whether a resume continues its session.
  implementPeak?: number;
  // The implementer's latest session, a fix step it ran included.
  implementerSession?: string;
  findings?: string[];
  // A fixer's give-ups are rewritten in place as Halts or Defers.
  triage?: TriageRecord[];
  // Set once a fixer fixed a finding.
  fixer?: Fixer;
  // The heads before the fix step, which a killed fixer or a rerun resets to.
  fixBase?: Heads;
  sessions: StepSession[];
  configFolder?: string;
  limitReadings?: LimitReadings;
  stop?: string;
  // Set once a landed ticket's review list and covered-later notes are posted, or found to need none.
  isReviewListPosted?: boolean;
}

interface RunState {
  tickets: Record<string, TicketState>;
  // Every ticket's, answered ones included, in the order raised; absent from a state file written before Halts.
  halts?: Halt[];
}

interface Run {
  spec: TrackedIssue;
  tickets: IssueRef[];
  isTicketless: boolean;
  state: RunState;
  landed: IssueRef[];
  warnings: Set<RunWarning>;
}

// Each pushed at most once per run.
type RunWarning = "missing-reading" | "unrecognised-limit-error";

interface LandingTicket {
  run: Run;
  ticket: TrackedIssue;
  pair: Pair;
  state: TicketState;
}

interface TicketRun extends LandingTicket {
  workspace: Workspace;
  targets: Target[];
}

type StepLaunch = Pick<StepRequest, "prompt" | "jsonSchema"> &
  Partial<
    Pick<StepRequest, "pair" | "targets" | "resumeSessionId" | "liveCeiling">
  >;

interface RanStep {
  result: StepResult;
  logPath: string;
}

interface LaunchedStep {
  record: unknown;
  logPath: string;
  peakContext: number | undefined;
}

type FixAttempt =
  | { kind: "done"; outcomes: FixOutcome[]; logPath: string }
  | { kind: "crossed"; logPath: string };

interface ImplementTake {
  ticketRun: TicketRun;
  launched: LaunchedStep;
  headsBefore: Heads;
}

interface HoldCheck {
  halt: Halt;
  // `<repo>#<n>`.
  ticket: string;
  downstreamOf: Map<string, string[]>;
}

interface DownstreamSearch {
  run: Run;
  blockersOf: Map<string, string[]>;
  ticket: string;
}

type TicketOutcome = "landed" | "stopped" | "leased" | "halted";

type Selection =
  | { kind: "launch"; ticket: TrackedIssue }
  | { kind: "stopped-again"; ticket: TrackedIssue; stop: string }
  | { kind: "none"; waiting: string[] };

export class SpecRun {
  private readonly config: SpecRunConfig;

  constructor(config: SpecRunConfig) {
    this.config = config;
  }

  static init(config: SpecRunConfig): SpecRun {
    return new SpecRun(config);
  }

  get workspaces(): IssueWorkspaces {
    return IssueWorkspaces.init(this._workspacesConfig);
  }

  get wrapUp(): WrapUp {
    const { github, githubOwner, knobs, outcomeFolder, stateFolder } =
      this.config;
    return WrapUp.init({
      workspaces: this._workspacesConfig,
      github,
      githubOwner,
      checks: knobs.checks,
      outcomeFolder,
      stateFolder,
      knobs: this.config.wrapUpKnobs,
      sleep: this.config.sleep,
      log: (line) => this.config.log?.(line),
    });
  }

  async run(specIssue: IssueRef): Promise<RunResult> {
    const startedAt = this.config.clock.now();
    const run = await this._startRun(specIssue);
    const launchable = await this._launchableTicketsOf(run);
    const refusal =
      this._authorshipRefusal(run, launchable) ??
      modelFitRefusalOf(run, launchable) ??
      targetsRefusalOf(run, launchable);
    if (refusal !== undefined) {
      this._log(run, `Refused: ${refusal}`);
      return { kind: "refused", landed: [], message: refusal };
    }
    const preflightStop = await this._preflightStop();
    if (preflightStop !== undefined) {
      return this._end(
        run,
        "stopped",
        `Preflight stopped the run: ${preflightStop}`,
      );
    }
    this._log(run, `Preflight passed in ${this._secondsSince(startedAt)}s.`);
    const reading = await this._readingOf(run);
    await this._announce(
      run,
      `Run started on ${run.tickets.length} tickets as ${readingLabelOf(reading)}.`,
    );
    for (;;) {
      const selection = await this._select(run);
      if (selection.kind === "none") {
        return this._finish(run, selection.waiting);
      }
      if (selection.kind === "stopped-again") {
        const label = issueLabelOf(selection.ticket.issue);
        return this._end(
          run,
          "stopped",
          `${label} is still open after its Stop (${selection.stop}); finish and land it, then rerun.`,
        );
      }
      let outcome: TicketOutcome;
      try {
        outcome = await this._runTicket(run, selection.ticket);
      } catch (error) {
        if (!(error instanceof RunStop)) throw error;
        return this._end(run, "stopped", error.message);
      }
      if (outcome === "leased" || outcome === "halted") continue;
      if (outcome === "stopped") {
        return this._end(
          run,
          "stopped",
          stoppedMessageOf(run, selection.ticket),
        );
      }
      run.landed.push(selection.ticket.issue);
    }
  }

  private get _workspacesConfig(): IssueWorkspacesConfig {
    const {
      primaryRoot,
      knobs,
      workspaceFolder,
      symlinkedFiles,
      installDependencies,
      github,
    } = this.config;
    return {
      primaryRoot,
      clonePaths: knobs.clonePaths,
      workspaceFolder,
      symlinkedFiles,
      installDependencies,
      issueTitle: async (issue) => (await github.issueOf(issue)).title,
    };
  }

  private async _startRun(specIssue: IssueRef): Promise<Run> {
    const spec = await this.config.github.issueOf(specIssue);
    const subIssues = await this.config.github.subIssuesOf(specIssue);
    mkdirSync(this.config.stateFolder, { recursive: true });
    return {
      spec,
      tickets: subIssues.length > 0 ? subIssues : [specIssue],
      isTicketless: subIssues.length === 0,
      state: this._readState(specIssue),
      landed: [],
      warnings: new Set(),
    };
  }

  private _readState(spec: IssueRef): RunState {
    const path = this._statePathOf(spec);
    if (!existsSync(path)) return { tickets: {} };
    return JSON.parse(readFileSync(path, "utf8")) as RunState;
  }

  private _statePathOf(spec: IssueRef): string {
    return join(this.config.stateFolder, `${fileStemOf(spec)}.run.json`);
  }

  // A ticketless spec has none; the preflight refusals check the spec itself.
  private async _launchableTicketsOf(run: Run): Promise<TrackedIssue[]> {
    if (run.isTicketless) return [];
    const launchable: TrackedIssue[] = [];
    for (const ticket of run.tickets) {
      const tracked = await this.config.github.issueOf(ticket);
      if (isLaunchable(tracked)) launchable.push(tracked);
    }
    return launchable;
  }

  private _authorshipRefusal(
    run: Run,
    launchable: TrackedIssue[],
  ): string | undefined {
    const { developer } = this.config;
    const offenders = [run.spec, ...launchable].flatMap((issue) => {
      const reason = untrustedBodyReasonOf(developer, issue);
      if (reason === undefined) return [];
      return [`${issueLabelOf(issue.issue)} (${reason})`];
    });
    if (offenders.length === 0) return undefined;
    return `Only ${developer} may write or edit the spec and each open ${readyLabel} ticket; refused ${offenders.join(", ")}.`;
  }

  // Runs no checks: master moves only through wrap-up, which checked the commits it landed.
  private async _preflightStop(): Promise<string | undefined> {
    const { knobs, primaryRoot } = this.config;
    for (const command of knobs.authChecks) {
      if ((await runCommand(command, primaryRoot)) !== undefined) {
        return `${commandLabelOf(command)} failed: GitHub auth or the claude login is missing`;
      }
    }
    for (const [repo, clonePath] of Object.entries(knobs.clonePaths)) {
      const clone = join(primaryRoot, clonePath);
      if (!existsSync(join(clone, ".git"))) {
        return `${repo}'s primary clone is missing at ${clone}`;
      }
      const branch = currentBranchOf(clone);
      if (branch !== "master") {
        return `${repo}'s primary checkout is on ${branch || "a detached HEAD"}, not master`;
      }
    }
    return undefined;
  }

  // Usage is undefined when the reader fails or has no usable reading for the configured account.
  private async _readingOf(run: Run): Promise<AccountReading> {
    const { account } = this.config.knobs;
    try {
      const readings = await this.config.usageReader.read();
      const usage = readings.find((r) => r.account === account)?.usage;
      return { account, usage };
    } catch (error) {
      this._log(run, `The usage read failed: ${messageOf(error)}`);
      return { account, usage: undefined };
    }
  }

  // Read afresh each pick; a ticket with every Halt answered goes first, oldest answered set first, then the frontier.
  private async _select(run: Run): Promise<Selection> {
    await this._postUnpostedHalts(run);
    await this._readAnswers(run);
    const openHalts = haltsOf(run).filter(({ answer }) => answer === undefined);
    const downstreamOf = await this._scopeDownstreamOf(run, openHalts);
    const waiting: string[] = [];
    const answered: { ticket: TrackedIssue; at: string }[] = [];
    const launchable: TrackedIssue[] = [];
    for (const ticket of run.tickets) {
      const tracked = await this.config.github.issueOf(ticket);
      if (!tracked.isOpen) continue;
      const label = issueLabelOf(ticket);
      const otherHolder = await this._otherHolderOf(ticket);
      if (otherHolder !== undefined) {
        waiting.push(`${label} is leased by ${holderLabelOf(otherHolder)}`);
        continue;
      }
      const { step, stop } = ticketStateOf(run, ticket);
      if (stop !== undefined) {
        return { kind: "stopped-again", ticket: tracked, stop };
      }
      const holding = openHalts.filter((halt) =>
        isHeldBy({ halt, ticket: shortRefOf(ticket), downstreamOf }),
      );
      if (holding.length > 0) {
        waiting.push(`${label} waits on Halt ${idListOf(holding)}`);
        continue;
      }
      const stopSpecs = undeliveredHaltsOf(run, ticket).filter(
        ({ answer }) => answer !== undefined && isStopSpecAnswer(answer),
      );
      if (stopSpecs.length > 0) {
        waiting.push(
          `${label}'s Halt ${idListOf(stopSpecs)} was answered \`stop spec\``,
        );
        continue;
      }
      if (!isLaunchable(tracked)) {
        waiting.push(`${label} waits on the developer`);
        continue;
      }
      const blockers = await this.config.github.openBlockersOf(ticket);
      if (blockers.length > 0) {
        waiting.push(
          `${label} is blocked by ${blockers.map(issueLabelOf).join(", ")}`,
        );
        continue;
      }
      if (step === "halted") {
        answered.push({ ticket: tracked, at: lastAnswerAtOf(run, ticket) });
      } else {
        launchable.push(tracked);
      }
    }
    answered.sort((first, second) => first.at.localeCompare(second.at));
    const [first] = [...answered.map(({ ticket }) => ticket), ...launchable];
    if (first === undefined) return { kind: "none", waiting };
    return { kind: "launch", ticket: first };
  }

  // The first reply naming an open Halt answers it; a later one is noted as ignored, once.
  private async _readAnswers(run: Run): Promise<void> {
    const posted = haltsOf(run).filter(({ isPosted }) => isPosted);
    if (posted.length === 0) return;
    const comments = await this.config.github.authoredCommentsOf(
      run.spec.issue,
    );
    const { developer } = this.config;
    for (const halt of posted) {
      const [first, ...later] = repliesTo({ halt, comments, developer });
      if (first === undefined) continue;
      if (halt.answer === undefined) {
        halt.answer = {
          replyId: first.id,
          text: first.body,
          at: this.config.clock.now().toISOString(),
        };
        this._saveState(run);
        this._log(
          run,
          `${haltNameOf(halt)} on ${issueLabelOf(halt.ticket)} is answered.`,
        );
        await this._comment(run, answeredNoteOf(halt));
      }
      const ignored = [first, ...later].filter(
        ({ id }) =>
          id !== halt.answer?.replyId && !halt.ignoredReplies.includes(id),
      );
      for (const reply of ignored) {
        halt.ignoredReplies.push(reply.id);
        this._saveState(run);
        await this._comment(run, ignoredNoteOf(halt, reply));
      }
    }
  }

  // Each ticket an open Halt names in its scope, to the tickets downstream of it; read only when a Halt names one.
  private async _scopeDownstreamOf(
    run: Run,
    openHalts: Halt[],
  ): Promise<Map<string, string[]>> {
    const named = new Set(
      openHalts.flatMap(({ scope }) => (scope === "spec" ? [] : scope)),
    );
    const downstreamOf = new Map<string, string[]>();
    if (named.size === 0) return downstreamOf;
    const blockersOf = await this._blockersByTicketOf(run);
    named.forEach((ticket) => {
      downstreamOf.set(ticket, downstreamIn({ run, blockersOf, ticket }));
    });
    return downstreamOf;
  }

  // An UnhandledStop leaves the ticket unlanded, commented on and noticed; a lease taken since the pick leaves it waiting.
  private async _runTicket(
    run: Run,
    ticket: TrackedIssue,
  ): Promise<TicketOutcome> {
    const state = ticketStateOf(run, ticket.issue);
    try {
      const pair = pairOf(ticket.body);
      if (pair === undefined) {
        throw new UnhandledStop(
          "model-fit",
          "The ## Model fit section changed after preflight.",
          this._progressPathOf(run),
        );
      }
      if (state.step === "halted") state.step = "resume";
      this._log(
        run,
        `${issueLabelOf(ticket.issue)}: launching on ${pairLabelOf(pair)} from ${state.step}.`,
      );
      if (state.step !== "wrap-up") {
        const workspace = await this._timed({ run, ticket }, "workspace", () =>
          this._workspaceFor(run, ticket.issue),
        );
        const targets = targetsAtLaunchOf(ticket, this._progressPathOf(run));
        await this._runSteps({ run, ticket, pair, workspace, state, targets });
      } else {
        const landing = await this.workspaces.find(ticket.issue);
        if (landing) await this._takeLease(run, landing);
      }
      await this._timed({ run, ticket }, "wrap-up", () =>
        this._land({ run, ticket, pair, state }),
      );
      return "landed";
    } catch (error) {
      if (error instanceof LeaseHeld) {
        this._log(run, `${issueLabelOf(ticket.issue)}: ${error.message}`);
        return "leased";
      }
      if (error instanceof TicketHalted) return "halted";
      if (!(error instanceof UnhandledStop)) throw error;
      await this._stopTicket(run, ticket, error);
      return "stopped";
    } finally {
      await this._releaseLeaseOf(ticket.issue);
    }
  }

  private async _otherHolderOf(
    issue: IssueRef,
  ): Promise<LeaseHolder | undefined> {
    const lease = (await this.workspaces.find(issue))?.lease;
    return otherLiveHolderOf(lease, runHolder);
  }

  private async _releaseLeaseOf(issue: IssueRef): Promise<void> {
    const workspace = await this.workspaces.find(issue);
    if (workspace?.lease && isSameHolder(workspace.lease, runHolder)) {
      await this.workspaces.releaseLease(workspace);
    }
  }

  private async _takeLease(run: Run, workspace: Workspace): Promise<void> {
    try {
      await this.workspaces.takeLease(workspace, runHolder);
    } catch (error) {
      if (error instanceof LeaseHeld) throw error;
      throw new UnhandledStop(
        "workspace",
        messageOf(error),
        this._progressPathOf(run),
      );
    }
  }

  private async _workspaceFor(run: Run, issue: IssueRef): Promise<Workspace> {
    const existing = await this.workspaces.find(issue);
    if (!existing) {
      const created = await this.workspaces.create(issue);
      await this._takeLease(run, created);
      return created;
    }
    await this._takeLease(run, existing);
    try {
      await this.workspaces.resume(existing);
    } catch (error) {
      throw new UnhandledStop(
        "workspace",
        messageOf(error),
        this._progressPathOf(run),
      );
    }
    this._log(run, `${issueLabelOf(issue)}: resumed ${existing.path}.`);
    return existing;
  }

  private async _runSteps(ticketRun: TicketRun): Promise<void> {
    const { state } = ticketRun;
    if (state.step === "implement") {
      await this._timed(ticketRun, "implement", () =>
        this._implement(ticketRun),
      );
      // A ticket with no code has nothing to review or check.
      const next = state.record?.status === "applied" ? "wrap-up" : "review";
      this._advance(ticketRun, next);
    }
    if (state.step === "resume") {
      await this._timed(ticketRun, "resume", () => this._resume(ticketRun));
      this._advance(ticketRun, stepAfterResumeOf(state));
    }
    if (state.step === "review") {
      await this._timed(ticketRun, "review", () => this._review(ticketRun));
      const hasFindings = (state.findings ?? []).length > 0;
      this._advance(ticketRun, hasFindings ? "triage" : "checks");
    }
    if (state.step === "triage") {
      await this._timed(ticketRun, "triage", () => this._triage(ticketRun));
      const hasFix = (state.triage ?? []).some(isFix);
      this._advance(ticketRun, hasFix ? "fix" : "checks");
    }
    // Checks run after the fixes, so a fix that turns them red Stops.
    if (state.step === "fix") {
      await this._timed(ticketRun, "fix", () => this._fix(ticketRun));
      this._advance(ticketRun, "checks");
    }
    if (state.step === "checks") {
      await this._haltOnUnpostedHalts(ticketRun);
      await this._timed(ticketRun, "checks", () => this._check(ticketRun));
      this._advance(ticketRun, "wrap-up");
    }
  }

  private async _implement(ticketRun: TicketRun): Promise<void> {
    const headsBefore = await this._headsOf(ticketRun.workspace);
    const launched = await this._launch(ticketRun, "implement", {
      prompt: this._implementPromptOf(ticketRun),
      jsonSchema: implementOutputSchema,
    });
    await this._takeImplementRecord({ ticketRun, launched, headsBefore });
  }

  private _implementPromptOf({ ticket, workspace }: TicketRun): string {
    return implementPrompt({
      issue: ticket.issue,
      title: ticket.title,
      body: ticket.body,
      branch: workspace.branch,
      branchedRepos: workspace.branchedRepos,
      promoteCommand: this.config.promoteCommandOf(ticket.issue),
      allowedWriteGlobs: this.config.knobs.allowedWriteGlobs,
    });
  }

  // Each blocker is a Halt; a blocked record, having committed nothing to review, posts them at once.
  private async _takeImplementRecord({
    ticketRun,
    launched,
    headsBefore,
  }: ImplementTake): Promise<void> {
    const { workspace, state } = ticketRun;
    const record = implementRecordOf(launched.record);
    const { logPath } = launched;
    state.implementPeak = launched.peakContext;
    state.implementerSession = lastSessionOf(state, "implement");
    const hasNewCommit = !isSameHeads(
      headsBefore,
      await this._headsOf(workspace),
    );
    // A resumed ticket whose answers needed no change returns its earlier commits again.
    const isRecommit =
      record.status === "committed" && state.record?.status === "committed";
    const problems = implementRecordProblems(
      record,
      hasNewCommit || isRecommit,
    );
    if (problems.length > 0) {
      throw new UnhandledStop("schema-failure", problems.join("; "), logPath);
    }
    if (record.status === "handoff") {
      throw new UnhandledStop("handoff", record.handoff.conclusion, logPath);
    }
    await this._raiseBlockerHalts(ticketRun, record.blockers);
    if (record.status === "blocked") {
      await this._haltOnUnpostedHalts(ticketRun);
    }
    state.record = record;
  }

  private async _raiseBlockerHalts(
    ticketRun: TicketRun,
    blockers: Blocker[],
  ): Promise<void> {
    if (blockers.length === 0) return;
    const downstream = await this._downstreamOf(
      ticketRun.run,
      ticketRun.ticket.issue,
    );
    raiseHalts(
      ticketRun,
      blockers.map((blocker) => blockerHaltOf(blocker, downstream)),
    );
  }

  // Posts the ticket's new Halts and halts it; with none, the ticket goes on.
  private async _haltOnUnpostedHalts(ticketRun: TicketRun): Promise<void> {
    const { run, ticket } = ticketRun;
    const unposted = haltsOfTicket(run, ticket.issue).filter(
      ({ isPosted }) => !isPosted,
    );
    if (unposted.length === 0) return;
    this._advance(ticketRun, "halted");
    await this._postUnpostedHalts(run);
    throw new TicketHalted(issueLabelOf(ticket.issue));
  }

  // Also picks up the Halts of a ticket that halted in a run killed before they were all posted.
  private async _postUnpostedHalts(run: Run): Promise<void> {
    const unposted = haltsOf(run).filter(
      (halt) =>
        !halt.isPosted && ticketStateOf(run, halt.ticket).step === "halted",
    );
    for (const halt of unposted) {
      const batch = unposted.filter(({ ticket }) =>
        isSameIssue(ticket, halt.ticket),
      );
      const post: HaltPost = {
        halt,
        index: batch.indexOf(halt) + 1,
        count: batch.length,
        ticketTitle: (await this.config.github.issueOf(halt.ticket)).title,
      };
      await this._comment(run, haltCommentOf(post));
      halt.isPosted = true;
      this._saveState(run);
      await this._announce(run, haltNoticeOf(post));
    }
  }

  // The resumed implementer gets every answer while its session is under the ticket budget; otherwise a fresh agent does.
  private async _resume(ticketRun: TicketRun): Promise<void> {
    const { run, ticket, workspace, state } = ticketRun;
    const halts = undeliveredHaltsOf(run, ticket.issue);
    const headsBefore = await this._headsOf(workspace);
    const sessionId = implementerSessionOf(state);
    const peak = state.implementPeak ?? Infinity;
    const isUnderBudget = peak < this.config.knobs.ticketBudget;
    let launch: StepLaunch;
    if (sessionId !== undefined && isUnderBudget) {
      launch = {
        prompt: resumePrompt(halts),
        resumeSessionId: sessionId,
        jsonSchema: implementOutputSchema,
      };
    } else {
      launch = {
        prompt: `${this._implementPromptOf(ticketRun)}\n\n${freshResumeSection(halts)}`,
        jsonSchema: implementOutputSchema,
      };
    }
    const launched = await this._launch(ticketRun, "implement", launch);
    halts.forEach((halt) => {
      halt.isDelivered = true;
    });
    await this._takeImplementRecord({ ticketRun, launched, headsBefore });
  }

  // Every repo's HEAD, so any commit in any repo changes it.
  private async _headsOf(workspace: Workspace): Promise<Heads> {
    const heads: Heads = {};
    for (const { clonePath, worktree } of this._worktreesOf(workspace)) {
      heads[clonePath] = await git(worktree, "rev-parse", "HEAD");
    }
    return heads;
  }

  private _worktreesOf(workspace: Workspace): CloneWorktree[] {
    return Object.entries(this.config.knobs.clonePaths).flatMap(
      ([repo, clonePath]) => {
        const worktree = join(workspace.path, clonePath);
        return existsSync(worktree) ? [{ repo, clonePath, worktree }] : [];
      },
    );
  }

  private async _review(ticketRun: TicketRun): Promise<void> {
    const { ticket, workspace, state } = ticketRun;
    const { record } = await this._launch(ticketRun, "review", {
      prompt: reviewPrompt({
        issue: ticket.issue,
        title: ticket.title,
        skillName: this.config.knobs.skillNames.review,
        branch: workspace.branch,
        branchedRepos: branchedReposOf(state),
      }),
      jsonSchema: reviewRecordSchema,
    });
    state.findings = (record as ReviewRecord).findings;
  }

  // Triage never edits, so it runs with no targets; a refused record gets one retry in the same session.
  private async _triage(ticketRun: TicketRun): Promise<void> {
    const { ticket, workspace, state } = ticketRun;
    const findings = state.findings ?? [];
    const launch = {
      pair: this.config.knobs.triagePair,
      targets: [],
      jsonSchema: triageOutputSchema,
    };
    const first = await this._launch(ticketRun, "triage", {
      ...launch,
      prompt: triagePrompt({
        issue: ticket.issue,
        title: ticket.title,
        branch: workspace.branch,
        branchedRepos: branchedReposOf(state),
        findings,
      }),
    });
    let records = triageRecordsOf(first.record);
    const problems = triageRecordProblems(findings.length, records);
    if (problems.length > 0) {
      const retry = await this._launch(ticketRun, "triage", {
        ...launch,
        prompt: triageRetryPrompt(problems),
        resumeSessionId: lastSessionOf(state, "triage"),
      });
      records = triageRecordsOf(retry.record);
      const retryProblems = triageRecordProblems(findings.length, records);
      if (retryProblems.length > 0) {
        throw new UnhandledStop(
          "schema-failure",
          retryProblems.join("; "),
          retry.logPath,
        );
      }
    }
    state.triage = records;
    raiseHalts(
      ticketRun,
      records.filter(isHalt).map((record) => triageHaltOf(record, "verdict")),
    );
  }

  // The resumed implementer fixes under the ticket budget; otherwise, or once killed, the triage agent does.
  private async _fix(ticketRun: TicketRun): Promise<void> {
    const { run, ticket, workspace, state } = ticketRun;
    const fixes = (state.triage ?? []).filter(isFix);
    if (state.fixBase === undefined) {
      state.fixBase = await this._headsOf(workspace);
      this._saveState(run);
    } else {
      await resetTo(workspace, state.fixBase);
    }
    const base = state.fixBase;
    const peak = state.implementPeak ?? Infinity;
    const isUnderBudget = peak < this.config.knobs.ticketBudget;
    let fixer: Fixer = isUnderBudget ? "implementer" : "triage";
    let attempt = await this._runFixer(ticketRun, fixer, fixes);
    if (attempt.kind === "crossed" && fixer === "implementer") {
      await resetTo(workspace, base);
      this._log(
        run,
        `${issueLabelOf(ticket.issue)}: the implementer's fix crossed the live ceiling; handing the batch to the triage agent.`,
      );
      fixer = "triage";
      attempt = await this._runFixer(ticketRun, fixer, fixes);
    }
    if (attempt.kind === "crossed") {
      await resetTo(workspace, base);
      throw new UnhandledStop(
        "step-error",
        `The triage agent's fix crossed the live ceiling of ${this.config.knobs.liveCeiling}; its work is discarded.`,
        attempt.logPath,
      );
    }
    const { outcomes, logPath } = attempt;
    const { heads, dirtyRepos } = await this._headsAndDirtyReposOf(workspace);
    const hasNewCommit = !isSameHeads(base, heads);
    const problems = fixRecordProblems({
      fixes,
      outcomes,
      hasNewCommit,
      dirtyRepos,
    });
    if (problems.length > 0) {
      throw new UnhandledStop("schema-failure", problems.join("; "), logPath);
    }
    const downstream = await this._downstreamOf(run, ticket.issue);
    const gaveUps = outcomes.filter(isGaveUp);
    state.triage = (state.triage ?? []).map((record) => {
      const gaveUp = gaveUps.find(({ finding }) => finding === record.finding);
      if (gaveUp === undefined) return record;
      return giveUpRecordOf({ record, gaveUp, downstream });
    });
    const gaveUpHalts = state.triage.filter(
      (record) =>
        isHalt(record) &&
        gaveUps.some(({ finding }) => finding === record.finding),
    );
    raiseHalts(
      ticketRun,
      gaveUpHalts.map((record) => triageHaltOf(record, "give-up")),
    );
    if (outcomes.some(({ status }) => status === "fixed")) state.fixer = fixer;
  }

  private async _headsAndDirtyReposOf(
    workspace: Workspace,
  ): Promise<HeadsAndDirtyRepos> {
    const heads: Heads = {};
    const worktrees: RepoWorktree[] = [];
    for (const { repo, clonePath, worktree } of this._worktreesOf(workspace)) {
      const state = await worktreeStateOf(worktree);
      heads[clonePath] = state.head;
      worktrees.push({ repo, worktree, state });
    }
    return { heads, dirtyRepos: dirtyReposOf(worktrees) };
  }

  private async _runFixer(
    ticketRun: TicketRun,
    fixer: Fixer,
    fixes: TriageRecord[],
  ): Promise<FixAttempt> {
    const { ticket, pair, workspace, state } = ticketRun;
    const { knobs } = this.config;
    let resumed: Pick<StepRequest, "pair" | "resumeSessionId">;
    if (fixer === "implementer") {
      resumed = { pair, resumeSessionId: implementerSessionOf(state) };
    } else {
      resumed = {
        pair: strongerPairOf(knobs.triagePair, pair),
        resumeSessionId: lastSessionOf(state, "triage"),
      };
    }
    const { result, logPath } = await this._runStep(ticketRun, "fix", {
      ...resumed,
      liveCeiling: knobs.liveCeiling,
      prompt: fixPrompt({
        issue: ticket.issue,
        title: ticket.title,
        branch: workspace.branch,
        branchedRepos: branchedReposOf(state),
        fixes,
      }),
      jsonSchema: fixOutputSchema,
    });
    if (fixer === "implementer") {
      state.implementPeak = result.peakContext ?? state.implementPeak;
      state.implementerSession = result.sessionId ?? state.implementerSession;
    }
    if (result.hasCrossedCeiling) return { kind: "crossed", logPath };
    const record = recordOf("fix", result, logPath);
    return { kind: "done", outcomes: fixOutcomesOf(record), logPath };
  }

  // The run's tickets this one blocks, directly or through another, each `<repo>#<n>`.
  private async _downstreamOf(run: Run, issue: IssueRef): Promise<string[]> {
    const blockersOf = await this._blockersByTicketOf(run);
    return downstreamIn({ run, blockersOf, ticket: shortRefOf(issue) });
  }

  // Each of the run's tickets, `<repo>#<n>`, to its open blockers.
  private async _blockersByTicketOf(run: Run): Promise<Map<string, string[]>> {
    const blockersOf = new Map<string, string[]>();
    for (const ticket of run.tickets) {
      const blockers = await this.config.github.openBlockersOf(ticket);
      blockersOf.set(shortRefOf(ticket), blockers.map(shortRefOf));
    }
    return blockersOf;
  }

  private async _launch(
    ticketRun: TicketRun,
    agent: StepAgent,
    launch: StepLaunch,
  ): Promise<LaunchedStep> {
    const { result, logPath } = await this._runStep(ticketRun, agent, launch);
    const record = recordOf(agent, result, logPath);
    return { record, logPath, peakContext: result.peakContext };
  }

  // Leaves the result unread, so a fixer can check for a live-ceiling kill before recordOf().
  private async _runStep(
    ticketRun: TicketRun,
    agent: StepAgent,
    { prompt, jsonSchema, ...overrides }: StepLaunch,
  ): Promise<RanStep> {
    const { run, ticket, pair, workspace, state, targets } = ticketRun;
    const { knobs } = this.config;
    const usage = await this._waitForLaunch(run);
    if (usage !== undefined) {
      state.limitReadings ??= {};
      state.limitReadings.before ??= limitReadingOf(usage);
    }
    const logPath = this._stepLogPathOf(ticketRun, agent);
    this._log(
      run,
      `${issueLabelOf(ticket.issue)}: ${agent} step, raw stream in ${logPath}.`,
    );
    const result = await this._agentResultOf(agent, {
      prompt,
      pair,
      account: knobs.account,
      cwd: workspace.path,
      maxTurns: knobs.maxTurns[agent],
      allowedTools: knobs.allowedTools[agent],
      allowedWriteGlobs: knobs.allowedWriteGlobs,
      targets,
      jsonSchema,
      logPath,
      ...overrides,
    });
    if (result.sessionId !== undefined) {
      state.sessions.push({ agent, sessionId: result.sessionId });
    }
    state.configFolder = result.configFolder ?? state.configFolder;
    this._saveState(run);
    await this._stopOnLimitHit(run, result, logPath);
    return { result, logPath };
  }

  private async _agentResultOf(
    step: string,
    request: StepRequest & { logPath: string },
  ): Promise<StepResult> {
    try {
      return await this.config.agentStep.run(request);
    } catch (error) {
      throw new UnhandledStop(
        "step-error",
        `The ${step} step failed to run: ${messageOf(error)}`,
        request.logPath,
      );
    }
  }

  // Asks the limit guard about the configured account until it says launch, returning the first reading: a ticket's Limit used before.
  private async _waitForLaunch(run: Run): Promise<AccountUsage | undefined> {
    const { account } = this.config.knobs;
    const knobs = { ...defaultLimitGuardKnobs, ...this.config.limitGuardKnobs };
    let hasAnnouncedWait = false;
    let first: AccountUsage | undefined;
    for (;;) {
      const reading = await this._readingOf(run);
      const { usage } = reading;
      if (usage === undefined) {
        await this._warnOnce(
          run,
          "missing-reading",
          `No usage reading for account ${account}; steps launch unguarded.`,
        );
        return first;
      }
      first ??= usage;
      const decision = decideStep(
        [reading],
        {
          pinnedAccount: account,
          isAtTicketBoundary: true,
          accountChangesToday: 0,
        },
        knobs,
      );
      if (decision.kind === "launch") return first;
      if (decision.kind === "stop") {
        throw new RunStop(
          `Account ${account} is at ${percentOf(usage.sevenDay.utilization)} of its weekly limit, past the reserve; rerun after it resets at ${usage.sevenDay.resetsAt.toISOString()}.`,
        );
      }
      if (decision.kind !== "limitWait") {
        throw new Error(`A one-account run can't ${decision.kind}`);
      }
      if (!hasAnnouncedWait) {
        hasAnnouncedWait = true;
        await this._announce(
          run,
          `Limit wait: account ${account} is at ${percentOf(usage.fiveHour.utilization)} of its 5-hour limit; continuing after ${decision.until.toISOString()}.`,
        );
      }
      const waitMs =
        decision.until.getTime() - this.config.clock.now().getTime();
      await this._sleep(Math.max(waitMs, knobs.limitWaitMarginMs));
    }
  }

  private get _sleep(): (ms: number) => Promise<void> {
    return this.config.sleep ?? sleep;
  }

  private async _warnOnce(
    run: Run,
    warning: RunWarning,
    summary: string,
  ): Promise<void> {
    if (run.warnings.has(warning)) return;
    run.warnings.add(warning);
    await this._announce(run, summary);
  }

  // The tree stays as is in the workspace; the first stream ever seen is kept for tightening limit detection.
  private async _stopOnLimitHit(
    run: Run,
    { limitHit, exitSubtype, output }: StepResult,
    logPath: string,
  ): Promise<void> {
    const hasSucceeded = exitSubtype === "success" && output.status === "valid";
    // A step that met a limit and still succeeded, as after a retry, isn't stopped.
    if (limitHit === undefined || hasSucceeded) return;
    const { window, resetsAt } = limitHit;
    const savedPath = join(this.config.stateFolder, "first-limit-hit.jsonl");
    if (!existsSync(savedPath) && existsSync(logPath)) {
      copyFileSync(logPath, savedPath);
    }
    if (resetsAt === undefined) {
      await this._warnOnce(
        run,
        "unrecognised-limit-error",
        `Unrecognised limit error on account ${this.config.knobs.account}; the saved stream can tighten detection.`,
      );
      throw new UnhandledStop(
        "limit-hit",
        "The step hit an unrecognised limit error; its reset is unknown.",
        logPath,
      );
    }
    throw new UnhandledStop(
      "limit-hit",
      `The step hit the ${window ?? "usage"} limit; it resets at ${resetsAt.toISOString()}.`,
      logPath,
    );
  }

  private _stepLogPathOf(ticketRun: TicketRun, agent: StepAgent): string {
    const index = ticketRun.state.sessions.length + 1;
    return join(
      this._stepsFolderOf(ticketRun.run),
      `${fileStemOf(ticketRun.ticket.issue)}-${index}-${agent}.jsonl`,
    );
  }

  private _stepsFolderOf(run: Run): string {
    const folder = join(
      this.config.stateFolder,
      `${fileStemOf(run.spec.issue)}-steps`,
    );
    mkdirSync(folder, { recursive: true });
    return folder;
  }

  private async _check(ticketRun: TicketRun): Promise<void> {
    for (const command of this.config.knobs.checks) {
      this._log(
        ticketRun.run,
        `${issueLabelOf(ticketRun.ticket.issue)}: checking ${commandLabelOf(command)}.`,
      );
      const failure = await runCommand(command, ticketRun.workspace.path);
      if (failure !== undefined) {
        await this._stopOnRedMaster(ticketRun);
        throw new UnhandledStop(
          "red-checks",
          `${commandLabelOf(command)} failed:\n${failure}`,
          this._progressPathOf(ticketRun.run),
        );
      }
    }
  }

  // Checks run in a master set, so neither another session's uncommitted edit nor a local fix hides master's own state.
  private async _stopOnRedMaster({ run, ticket }: TicketRun): Promise<void> {
    const prefix = `Stopped the run at ${issueLabelOf(ticket.issue)}'s checks`;
    let masterSet: string;
    try {
      masterSet = await this.workspaces.masterSet(run.spec.issue);
    } catch (error) {
      throw new RunStop(
        `${prefix}: the master set failed to build: ${messageOf(error)}`,
      );
    }
    for (const command of this.config.knobs.checks) {
      if ((await runCommand(command, masterSet)) !== undefined) {
        throw new RunStop(`${prefix}: master red: ${commandLabelOf(command)}`);
      }
    }
  }

  // Needs no workspace: a wrap-up killed after removing it resumes from its own progress file.
  private async _land(landingTicket: LandingTicket): Promise<void> {
    const { run, ticket, state } = landingTicket;
    const { usage } = await this._readingOf(run);
    if (usage !== undefined) {
      state.limitReadings = {
        ...state.limitReadings,
        after: limitReadingOf(usage),
      };
    }
    this._writeFacts(landingTicket);
    this._log(run, `${issueLabelOf(ticket.issue)}: wrapping up.`);
    try {
      await this.wrapUp.run(ticket.issue);
    } catch (error) {
      throw new UnhandledStop(
        "wrap-up-failure",
        messageOf(error),
        this._progressPathOf(run),
      );
    }
    this._advance(landingTicket, "landed");
    this._log(run, `${issueLabelOf(ticket.issue)}: landed.`);
    await this._postReviewList(run, ticket);
  }

  // Posts the notes before the comment, so a ticket marked posted has posted both.
  private async _postReviewList(run: Run, ticket: TrackedIssue): Promise<void> {
    const state = ticketStateOf(run, ticket.issue);
    if (state.isReviewListPosted) return;
    const records = state.triage ?? [];
    await this._postCoveredLaterNotes(ticket.issue, records);
    const body = ticketReviewListOf({
      ticket: ticket.issue,
      title: ticket.title,
      records,
    });
    if (body !== undefined && !(await this._hasReviewList(run, ticket.issue))) {
      await this._postReviewListComment(run, ticket.issue, body);
    }
    state.isReviewListPosted = true;
    this._saveState(run);
  }

  // Each checks the later ticket for its mark first, so a rerun never posts it twice.
  private async _postCoveredLaterNotes(
    ticket: IssueRef,
    records: TriageRecord[],
  ): Promise<void> {
    const { github } = this.config;
    for (const note of coveredLaterNotesOf(ticket, records)) {
      const bodies = await github.commentsOf(note.issue);
      if (bodies.some((body) => body.includes(note.mark))) continue;
      await github.comment(note.issue, `${runnerMark}\n${note.body}`);
    }
  }

  // The marker, not run state, is the record: a run killed after posting but before saving finds it.
  private async _hasReviewList(
    run: Run,
    subject: ReviewListSubject,
  ): Promise<boolean> {
    const mark = reviewListMarkOf(subject);
    const comments = await this._runnersSpecCommentsOf(run);
    return comments.some((body) => body.includes(mark));
  }

  private async _runnersSpecCommentsOf(run: Run): Promise<string[]> {
    const comments = await this.config.github.authoredCommentsOf(
      run.spec.issue,
    );
    return comments.filter(isRunnersComment).map(({ body }) => body);
  }

  private async _postReviewListComment(
    run: Run,
    subject: ReviewListSubject,
    body: string,
  ): Promise<void> {
    await this._comment(run, body);
    const { items } = undecidedCountOf([body]);
    if (this.config.knobs.reviewListCadence === "per-ticket" && items > 0) {
      await this._announce(run, ticketPushOf(subject, items));
    }
  }

  private _writeFacts({ run, ticket, pair, state }: LandingTicket): void {
    const { record, configFolder, sessions, limitReadings } = state;
    if (record === undefined) {
      throw new Error(
        `${issueLabelOf(ticket.issue)} reached its wrap-up with no implement record`,
      );
    }
    const facts: WrapUpFacts = {
      branches: record.branches.map(({ repo, branch }) => ({ repo, branch })),
      closingComment: record.closingComment,
      boxesUndone: record.boxesUndone,
      reviewFixes: state.fixer ?? "none",
      defers: (state.triage ?? []).filter(({ verdict }) => verdict === "defer")
        .length,
      reviewRounds: 1,
      retries: 0,
      pair: pairLabelOf(pair),
      limitReadings,
    };
    const haltKinds = new Set(
      haltsOfTicket(run, ticket.issue).map(({ kind }) => haltKindLabelOf(kind)),
    );
    if (haltKinds.size > 0) facts.halt = [...haltKinds].join(", ");
    if (record.status === "applied") {
      facts.reviewFixes = "skipped";
      facts.reviewRounds = 0;
      facts.githubWrites = record.githubWrites;
    }
    if (configFolder !== undefined) {
      facts.sessions = {
        account: this.config.knobs.account,
        configFolder,
        steps: sessions,
      };
    }
    writeFileSync(
      join(this.config.stateFolder, `${fileStemOf(ticket.issue)}.facts.json`),
      `${JSON.stringify(facts, undefined, 2)}\n`,
    );
  }

  // Logged however the step ends, a Stop or Halt included.
  private async _timed<RV>(
    { run, ticket }: Pick<LandingTicket, "run" | "ticket">,
    step: TimedStep,
    act: () => Promise<RV>,
  ): Promise<RV> {
    const startedAt = this.config.clock.now();
    try {
      return await act();
    } finally {
      this._log(
        run,
        `${issueLabelOf(ticket.issue)}: ${step} took ${this._secondsSince(startedAt)}s.`,
      );
    }
  }

  private _secondsSince(startedAt: Date): number {
    const ms = this.config.clock.now().getTime() - startedAt.getTime();
    return Math.round(ms / 1000);
  }

  private _advance({ run, state }: LandingTicket, step: TicketStep): void {
    state.step = step;
    this._saveState(run);
  }

  private _saveState(run: Run): void {
    writeFileSync(
      this._statePathOf(run.spec.issue),
      `${JSON.stringify(run.state, undefined, 2)}\n`,
    );
  }

  private async _stopTicket(
    run: Run,
    ticket: TrackedIssue,
    stop: UnhandledStop,
  ): Promise<void> {
    const state = ticketStateOf(run, ticket.issue);
    const outcome = stopOutcomes[stop.outcome];
    state.step = "stopped";
    state.stop = outcome;
    this._saveState(run);
    this._log(
      run,
      `${issueLabelOf(ticket.issue)}: stopped on ${outcome}; details in the spec-issue comment.`,
    );
    await this._comment(
      run,
      [
        `The runner stopped on ${issueLabelOf(ticket.issue)}, "${ticket.title}": ${outcome}.`,
        stop.message,
        `Log: \`${stop.logPath}\``,
        "The ticket is left unlanded in its issue workspace. Finish it there by hand and land it with the standalone wrap-up; a rerun skips it once it is closed.",
      ].join("\n\n"),
    );
  }

  // Marked, since the runner posts as the developer's login and must never read its own comment as an answer.
  private async _comment(run: Run, body: string): Promise<void> {
    await this.config.github.comment(run.spec.issue, `${runnerMark}\n${body}`);
  }

  // The gap check waits for every ticket to close, since an open one may still land what it would report.
  private async _finish(run: Run, waiting: string[]): Promise<RunResult> {
    await this._postLandedReviewLists(run);
    if (waiting.length === 0) {
      try {
        await this._gapCheck(run);
      } catch (error) {
        if (error instanceof RunStop) {
          return this._end(run, "stopped", error.message);
        }
        if (!(error instanceof UnhandledStop)) throw error;
        return this._end(
          run,
          "stopped",
          `The gap check stopped on ${stopOutcomes[error.outcome]}: ${error.message} Log: \`${error.logPath}\`. Rerun to retry it.`,
        );
      }
    }
    const message = endMessageOf(run.landed, waiting);
    return this._end(
      run,
      "finished",
      await this._withUndecidedLine(run, message),
    );
  }

  // Catches a ticket that landed in a run killed before its review list was posted.
  private async _postLandedReviewLists(run: Run): Promise<void> {
    for (const ticket of run.tickets) {
      const state = run.state.tickets[issueLabelOf(ticket)];
      if (state?.step !== "landed" || state.isReviewListPosted) continue;
      await this._postReviewList(run, await this.config.github.issueOf(ticket));
    }
  }

  // Runs in the primary root on master, where every landed ticket's work is; it reads and writes nothing else.
  private async _gapCheck(run: Run): Promise<void> {
    if (await this._hasReviewList(run, gapCheckSubject)) return;
    const { knobs } = this.config;
    const tickets: GapCheckTicket[] = await Promise.all(
      run.tickets.map((ticket) => this.config.github.issueOf(ticket)),
    );
    await this._waitForLaunch(run);
    const logPath = join(this._stepsFolderOf(run), "gap-check.jsonl");
    this._log(run, `Gap check step, raw stream in ${logPath}.`);
    const result = await this._agentResultOf("gap check", {
      prompt: gapCheckPrompt({
        spec: run.spec.issue,
        title: run.spec.title,
        tickets,
      }),
      pair: knobs.gapCheckPair,
      account: knobs.account,
      cwd: this.config.primaryRoot,
      maxTurns: knobs.maxTurns.gapCheck,
      allowedTools: knobs.allowedTools.gapCheck,
      allowedWriteGlobs: [],
      targets: [],
      jsonSchema: gapCheckOutputSchema,
      logPath,
    });
    await this._stopOnLimitHit(run, result, logPath);
    const record = gapCheckRecordOf(recordOf("gap check", result, logPath));
    await this._postReviewListComment(
      run,
      gapCheckSubject,
      gapCheckListOf(run.spec.title, record),
    );
  }

  // Counts every review-list comment on the spec, earlier runs' included, since the developer decides them in one place.
  private async _withUndecidedLine(run: Run, message: string): Promise<string> {
    if (this.config.knobs.reviewListCadence !== "end-of-run") return message;
    const count = undecidedCountOf(await this._runnersSpecCommentsOf(run));
    if (count.items === 0) return message;
    return `${message} ${undecidedLineOf(count)}.`;
  }

  private async _end(
    run: Run,
    kind: RunResult["kind"],
    message: string,
  ): Promise<RunResult> {
    await this._announce(run, message);
    return { kind, landed: run.landed, message };
  }

  // A notice that fails is logged, not thrown: the comment and the progress log still hold the event.
  private async _announce(run: Run, summary: string): Promise<void> {
    this._log(run, summary);
    try {
      await this.config.notices.send({
        specTitle: run.spec.title,
        summary,
        link: run.spec.url,
      });
    } catch (error) {
      this._log(run, `The notice failed: ${messageOf(error)}`);
    }
  }

  // Newlines are folded so each event stays one line for tail -f.
  private _log(run: Run, line: string): void {
    const oneLine = line.replace(/\s*\n\s*/g, " ");
    appendFileSync(
      this._progressPathOf(run),
      `${this.config.clock.now().toISOString()} ${oneLine}\n`,
    );
    this.config.log?.(line);
  }

  private _progressPathOf(run: Run): string {
    return join(this.config.stateFolder, `${fileStemOf(run.spec.issue)}.log`);
  }
}

// Discards commits and untracked files alike; ignored files, such as the symlinked configs, stay.

function isFix({ verdict }: TriageRecord): boolean {
  return verdict === "fix";
}

function isHalt({ verdict }: TriageRecord): boolean {
  return verdict === "halt";
}

// Saved with the step's own state when it advances, so a rerun of the step never raises them twice.
function raiseHalts({ run, ticket }: TicketRun, drafts: HaltDraft[]): void {
  run.state.halts ??= [];
  const { halts } = run.state;
  drafts.forEach((draft) => {
    halts.push({
      ...draft,
      id: `H${halts.length + 1}`,
      ticket: ticket.issue,
      isPosted: false,
      isDelivered: false,
      ignoredReplies: [],
    });
  });
}

function haltsOf(run: Run): Halt[] {
  return run.state.halts ?? [];
}

function haltsOfTicket(run: Run, ticket: IssueRef): Halt[] {
  return haltsOf(run).filter((halt) => isSameIssue(halt.ticket, ticket));
}

function isSameIssue(first: IssueRef, second: IssueRef): boolean {
  return shortRefOf(first) === shortRefOf(second);
}

function undeliveredHaltsOf(run: Run, ticket: IssueRef): Halt[] {
  return haltsOfTicket(run, ticket).filter(({ isDelivered }) => !isDelivered);
}

// The halted ticket itself, every ticket for a `spec` scope, else the named tickets and their downstream.
function isHeldBy({ halt, ticket, downstreamOf }: HoldCheck): boolean {
  const { scope } = halt;
  if (shortRefOf(halt.ticket) === ticket || scope === "spec") return true;
  return scope.some(
    (named) =>
      named === ticket || (downstreamOf.get(named) ?? []).includes(ticket),
  );
}

function idListOf(halts: Halt[]): string {
  return halts.map(({ id }) => id).join(", ");
}

function lastAnswerAtOf(run: Run, ticket: IssueRef): string {
  const times = undeliveredHaltsOf(run, ticket).map(
    ({ answer }) => answer?.at ?? "",
  );
  return times.sort().at(-1) ?? "";
}

// A ticket halted before review has nothing reviewed yet; one with no code has nothing to review.
function stepAfterResumeOf(state: TicketState): TicketStep {
  if (state.record?.status === "applied") return "wrap-up";
  return state.findings === undefined ? "review" : "checks";
}

// The tickets downstream of one, each `<repo>#<n>`, through the blocking graph.
function downstreamIn({ run, blockersOf, ticket }: DownstreamSearch): string[] {
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

function isSameHeads(first: Heads, second: Heads): boolean {
  return JSON.stringify(first) === JSON.stringify(second);
}

function branchedReposOf(state: TicketState): string[] {
  return (state.record?.branches ?? []).map(({ repo }) => repo);
}

// Absent from a state file written before Halts, where the last implement session is the implementer's.
function implementerSessionOf(state: TicketState): string | undefined {
  return state.implementerSession ?? lastSessionOf(state, "implement");
}

function lastSessionOf(
  state: TicketState,
  agent: StepAgent,
): string | undefined {
  return state.sessions.findLast((session) => session.agent === agent)
    ?.sessionId;
}

async function resetTo(workspace: Workspace, heads: Heads): Promise<void> {
  for (const [clonePath, sha] of Object.entries(heads)) {
    const worktree = join(workspace.path, clonePath);
    await git(worktree, "reset", "--hard", sha);
    await git(worktree, "clean", "-fd");
  }
}

function isGaveUp(outcome: FixOutcome): outcome is GaveUpOutcome {
  return outcome.status === "gave-up";
}

function recordOf(step: string, result: StepResult, logPath: string): unknown {
  const { output } = result;
  if (output.status === "schemaFailure") {
    throw new UnhandledStop(
      "schema-failure",
      output.problems.join("; "),
      logPath,
    );
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

function ticketStateOf(run: Run, ticket: IssueRef): TicketState {
  const key = issueLabelOf(ticket);
  run.state.tickets[key] ??= { step: "implement", sessions: [] };
  return run.state.tickets[key];
}

// A split spec's own body is never checked; tickets the runner won't launch need no section.
function modelFitRefusalOf(
  run: Run,
  launchable: TrackedIssue[],
): string | undefined {
  if (run.isTicketless) {
    if (pairOf(run.spec.body) !== undefined) return undefined;
    return `${issueLabelOf(run.spec.issue)} has no sub-issues and no valid ## Model fit section: split it with /code-tickets, or add the section.`;
  }
  const offenders = launchable.flatMap(({ issue, body }) =>
    pairOf(body) === undefined ? [issueLabelOf(issue)] : [],
  );
  if (offenders.length === 0) return undefined;
  return `Each open ${readyLabel} ticket needs a ## Model fit section naming one of the five pairs; missing or invalid in ${offenders.join(", ")}.`;
}

function targetsRefusalOf(
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

function targetsAtLaunchOf(ticket: TrackedIssue, logPath: string): Target[] {
  const reading = targetsOf(ticket.body);
  if (reading.status === "valid") return reading.targets;
  throw new UnhandledStop(
    "targets",
    `The ## Targets section changed after preflight: \`${reading.line}\` isn't ${targetLineShapes}.`,
    logPath,
  );
}

function isLaunchable(ticket: TrackedIssue): boolean {
  return ticket.isOpen && ticket.labels.includes(readyLabel);
}

// The command's output tail when it fails, undefined when it passes.
async function runCommand(
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

function endMessageOf(landed: IssueRef[], waiting: string[]): string {
  const landedPart =
    landed.length === 0 ? "nothing" : landed.map(issueLabelOf).join(", ");
  const waitingPart =
    waiting.length === 0 ? "Every ticket is closed." : `${waiting.join("; ")}.`;
  return `Run ended: landed ${landedPart}. ${waitingPart}`;
}

function stoppedMessageOf(run: Run, ticket: TrackedIssue): string {
  const { stop } = ticketStateOf(run, ticket.issue);
  return `Stopped on ${issueLabelOf(ticket.issue)}: ${stop ?? "an unhandled outcome"}.`;
}

function readingLabelOf({ account, usage }: AccountReading): string {
  if (usage === undefined) return `account ${account}: no usage reading`;
  return `account ${account}: 5-hour ${percentOf(usage.fiveHour.utilization)}, weekly ${percentOf(usage.sevenDay.utilization)}`;
}

function limitReadingOf(usage: AccountUsage): LimitReading {
  return {
    fiveHour: usage.fiveHour.utilization,
    sevenDay: usage.sevenDay.utilization,
  };
}
