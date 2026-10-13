// The run loop: takes one spec's tickets, one at a time in blocking-graph order, through implement, review, checks and
// wrap-up in each ticket's issue workspace, and never closes the spec. Preflight refuses or Stops a run before it starts.
// Any outcome a later ticket will handle (findings, red checks, step errors, blockers, schema failures) is an UnhandledStop.
// GitHub and git hold what's durable; a per-spec state file holds the step each ticket reached, so a rerun resumes there.
// Steps launch through AgentStep.ts; prompts are implementStep.ts and reviewStep.ts; landing is WrapUp.ts; knobs are runKnobs.ts.

import { execFile } from "node:child_process";
import {
  appendFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";
import { promisify } from "node:util";

import type { AgentStep, Pair, StepRequest, StepResult } from "./AgentStep.ts";
import { messageOf, outputTailOf } from "./failureText.ts";
import { git } from "./git.ts";
import {
  implementPrompt,
  type ImplementRecord,
  implementRecordProblems,
  implementRecordSchema,
} from "./implementStep.ts";
import {
  fileStemOf,
  issueLabelOf,
  type IssueRef,
  IssueWorkspaces,
  type IssueWorkspacesConfig,
  type Workspace,
} from "./IssueWorkspaces.ts";
import { pairLabelOf, pairOf } from "./modelFit.ts";
import type { Notices } from "./Notices.ts";
import {
  reviewPrompt,
  type ReviewRecord,
  reviewRecordSchema,
} from "./reviewStep.ts";
import type { Command, KnobbedStep, RunKnobs } from "./runKnobs.ts";
import type { StepAgent, StepSession } from "./transcriptFacts.ts";
import { stopOutcomes, UnhandledStop } from "./UnhandledStop.ts";
import {
  WrapUp,
  type WrapUpFacts,
  type WrapUpGitHub,
  type WrapUpKnobs,
} from "./WrapUp.ts";

const execFileAsync = promisify(execFile);

const readyLabel = "ready-for-agent";

export interface TrackedIssue {
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
}

export interface Clock {
  now(): Date;
}

export interface SpecRunConfig {
  knobs: RunKnobs;
  agentStep: AgentStep;
  github: RunGitHub;
  notices: Notices;
  clock: Clock;
  githubOwner: string;
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
  sleep?(ms: number): Promise<void>;
  log?(line: string): void;
}

export interface RunResult {
  kind: "finished" | "refused" | "stopped";
  landed: IssueRef[];
  message: string;
}

type TicketStep =
  "implement" | "review" | "checks" | "wrap-up" | "landed" | "stopped";

interface TicketState {
  step: TicketStep;
  record?: ImplementRecord;
  sessions: StepSession[];
  configFolder?: string;
  stop?: string;
}

interface RunState {
  tickets: Record<string, TicketState>;
}

interface Run {
  spec: TrackedIssue;
  tickets: IssueRef[];
  isTicketless: boolean;
  state: RunState;
  landed: IssueRef[];
}

interface LandingTicket {
  run: Run;
  ticket: TrackedIssue;
  pair: Pair;
  state: TicketState;
}

interface TicketRun extends LandingTicket {
  workspace: Workspace;
}

interface LaunchedStep {
  record: unknown;
  logPath: string;
}

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
    const run = await this._startRun(specIssue);
    const refusal = await this._modelFitRefusal(run);
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
    await this._announce(run, `Run started on ${run.tickets.length} tickets.`);
    for (;;) {
      const selection = await this._select(run);
      if (selection.kind === "none") {
        return this._end(
          run,
          "finished",
          endMessageOf(run.landed, selection.waiting),
        );
      }
      if (selection.kind === "stopped-again") {
        const label = issueLabelOf(selection.ticket.issue);
        return this._end(
          run,
          "stopped",
          `${label} is still open after its Stop (${selection.stop}); finish and land it, then rerun.`,
        );
      }
      if (!(await this._runTicket(run, selection.ticket))) {
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

  // A split spec's own body is never checked; tickets the runner won't launch need no section.
  private async _modelFitRefusal(run: Run): Promise<string | undefined> {
    if (run.isTicketless) {
      if (pairOf(run.spec.body) !== undefined) return undefined;
      return `${issueLabelOf(run.spec.issue)} has no sub-issues and no valid ## Model fit section: split it with /to-tickets, or add the section.`;
    }
    const offenders: string[] = [];
    for (const ticket of run.tickets) {
      const tracked = await this.config.github.issueOf(ticket);
      if (isLaunchable(tracked) && pairOf(tracked.body) === undefined) {
        offenders.push(issueLabelOf(ticket));
      }
    }
    if (offenders.length === 0) return undefined;
    return `Each open ${readyLabel} ticket needs a ## Model fit section naming one of the five pairs; missing or invalid in ${offenders.join(", ")}.`;
  }

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
      const branch = await git(clone, "branch", "--show-current");
      if (branch !== "master") {
        return `${repo}'s primary checkout is on ${branch || "a detached HEAD"}, not master`;
      }
    }
    for (const command of knobs.checks) {
      if ((await runCommand(command, primaryRoot)) !== undefined) {
        return `master red: ${commandLabelOf(command)}`;
      }
    }
    return undefined;
  }

  // The label, blockers and state are read afresh for every pick, so a mid-run relabel takes effect.
  private async _select(run: Run): Promise<Selection> {
    const waiting: string[] = [];
    const launchable: TrackedIssue[] = [];
    for (const ticket of run.tickets) {
      const tracked = await this.config.github.issueOf(ticket);
      if (!tracked.isOpen) continue;
      const { stop } = ticketStateOf(run, ticket);
      if (stop !== undefined) {
        return { kind: "stopped-again", ticket: tracked, stop };
      }
      const label = issueLabelOf(ticket);
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
      launchable.push(tracked);
    }
    const [first] = launchable;
    if (first === undefined) return { kind: "none", waiting };
    return { kind: "launch", ticket: first };
  }

  // True once the ticket lands; an UnhandledStop leaves it unlanded, commented on and noticed.
  private async _runTicket(run: Run, ticket: TrackedIssue): Promise<boolean> {
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
      this._log(
        run,
        `${issueLabelOf(ticket.issue)}: launching on ${pairLabelOf(pair)} from ${state.step}.`,
      );
      if (state.step !== "wrap-up") {
        const workspace = await this._workspaceFor(run, ticket.issue);
        await this._runSteps({ run, ticket, pair, workspace, state });
      }
      await this._land({ run, ticket, pair, state });
      return true;
    } catch (error) {
      if (!(error instanceof UnhandledStop)) throw error;
      await this._stopTicket(run, ticket, error);
      return false;
    }
  }

  private async _workspaceFor(run: Run, issue: IssueRef): Promise<Workspace> {
    const existing = await this.workspaces.find(issue);
    if (!existing) return this.workspaces.create(issue);
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
      await this._implement(ticketRun);
      this._advance(ticketRun, "review");
    }
    if (state.step === "review") {
      await this._review(ticketRun);
      this._advance(ticketRun, "checks");
    }
    if (state.step === "checks") {
      await this._check(ticketRun);
      this._advance(ticketRun, "wrap-up");
    }
  }

  private async _implement(ticketRun: TicketRun): Promise<void> {
    const { ticket, workspace, state } = ticketRun;
    const headsBefore = await this._headsOf(workspace);
    const launched = await this._launch(ticketRun, "implement", {
      prompt: implementPrompt({
        issue: ticket.issue,
        title: ticket.title,
        body: ticket.body,
        branch: workspace.branch,
        branchedRepos: workspace.branchedRepos,
        promoteCommand: this.config.promoteCommandOf(ticket.issue),
      }),
      jsonSchema: implementRecordSchema,
    });
    const record = launched.record as ImplementRecord;
    const { logPath } = launched;
    const hasNewCommit = (await this._headsOf(workspace)) !== headsBefore;
    const problems = implementRecordProblems(record, hasNewCommit);
    if (problems.length > 0) {
      throw new UnhandledStop("schema-failure", problems.join("; "), logPath);
    }
    if (record.status === "handoff") {
      throw new UnhandledStop("handoff", record.handoff.conclusion, logPath);
    }
    if (record.blockers.length > 0) {
      const blockers = record.blockers.map(
        ({ kind, detail, recommendation }) =>
          `${kind}: ${detail} Recommended: ${recommendation}`,
      );
      throw new UnhandledStop("blocker", bulletsOf(blockers), logPath);
    }
    state.record = record;
  }

  // Every repo's branch and HEAD in one string, so any commit in any repo changes it.
  private async _headsOf(workspace: Workspace): Promise<string> {
    const heads: string[] = [];
    for (const clonePath of Object.values(this.config.knobs.clonePaths)) {
      const worktree = join(workspace.path, clonePath);
      if (!existsSync(worktree)) continue;
      heads.push(`${clonePath}:${await git(worktree, "rev-parse", "HEAD")}`);
    }
    return heads.join(" ");
  }

  private async _review(ticketRun: TicketRun): Promise<void> {
    const { ticket, workspace, state } = ticketRun;
    const { record, logPath } = await this._launch(ticketRun, "review", {
      prompt: reviewPrompt({
        issue: ticket.issue,
        title: ticket.title,
        skillName: this.config.knobs.skillNames.review,
        branch: workspace.branch,
        branchedRepos: (state.record?.branches ?? []).map(({ repo }) => repo),
      }),
      jsonSchema: reviewRecordSchema,
    });
    const { findings } = record as ReviewRecord;
    if (findings.length > 0) {
      throw new UnhandledStop("review-findings", bulletsOf(findings), logPath);
    }
  }

  private async _launch(
    ticketRun: TicketRun,
    agent: KnobbedStep,
    { prompt, jsonSchema }: Pick<StepRequest, "prompt" | "jsonSchema">,
  ): Promise<LaunchedStep> {
    const { run, ticket, pair, workspace, state } = ticketRun;
    const { knobs } = this.config;
    const logPath = this._stepLogPathOf(ticketRun, agent);
    this._log(
      run,
      `${issueLabelOf(ticket.issue)}: ${agent} step, raw stream in ${logPath}.`,
    );
    let result: StepResult;
    try {
      result = await this.config.agentStep.run({
        prompt,
        pair,
        account: knobs.account,
        cwd: workspace.path,
        maxTurns: knobs.maxTurns[agent],
        allowedTools: knobs.allowedTools[agent],
        jsonSchema,
        logPath,
      });
    } catch (error) {
      throw new UnhandledStop(
        "step-error",
        `The ${agent} step failed to run: ${messageOf(error)}`,
        logPath,
      );
    }
    if (result.sessionId !== undefined) {
      state.sessions.push({ agent, sessionId: result.sessionId });
    }
    state.configFolder = result.configFolder ?? state.configFolder;
    this._saveState(run);
    const { output } = result;
    if (output.status === "schemaFailure") {
      throw new UnhandledStop(
        "schema-failure",
        output.problems.join("; "),
        logPath,
      );
    }
    if (result.exitSubtype !== "success" || output.status !== "valid") {
      throw new UnhandledStop(
        "step-error",
        `The ${agent} step ended ${result.exitSubtype ?? "without a result"}.`,
        logPath,
      );
    }
    return { record: output.record, logPath };
  }

  private _stepLogPathOf(ticketRun: TicketRun, agent: StepAgent): string {
    const folder = join(
      this.config.stateFolder,
      `${fileStemOf(ticketRun.run.spec.issue)}-steps`,
    );
    mkdirSync(folder, { recursive: true });
    const index = ticketRun.state.sessions.length + 1;
    return join(
      folder,
      `${fileStemOf(ticketRun.ticket.issue)}-${index}-${agent}.jsonl`,
    );
  }

  private async _check(ticketRun: TicketRun): Promise<void> {
    for (const command of this.config.knobs.checks) {
      this._log(
        ticketRun.run,
        `${issueLabelOf(ticketRun.ticket.issue)}: checking ${commandLabelOf(command)}.`,
      );
      const failure = await runCommand(command, ticketRun.workspace.path);
      if (failure !== undefined) {
        throw new UnhandledStop(
          "red-checks",
          `${commandLabelOf(command)} failed:\n${failure}`,
          this._progressPathOf(ticketRun.run),
        );
      }
    }
  }

  // Needs no workspace: a wrap-up killed after removing it resumes from its own progress file.
  private async _land(landingTicket: LandingTicket): Promise<void> {
    const { run, ticket } = landingTicket;
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
  }

  private _writeFacts({ ticket, pair, state }: LandingTicket): void {
    const { record, configFolder, sessions } = state;
    if (record === undefined) {
      throw new Error(
        `${issueLabelOf(ticket.issue)} reached its wrap-up with no implement record`,
      );
    }
    const facts: WrapUpFacts = {
      branches: record.branches.map(({ repo, branch }) => ({ repo, branch })),
      closingComment: record.closing_comment,
      boxesUndone: record.boxes_undone,
      reviewFixes: "none",
      reviewRounds: 1,
      retries: 0,
      pair: pairLabelOf(pair),
    };
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
    await this.config.github.comment(
      run.spec.issue,
      [
        `The runner stopped on ${issueLabelOf(ticket.issue)}, "${ticket.title}": ${outcome}.`,
        stop.message,
        `Log: \`${stop.logPath}\``,
        "The ticket is left unlanded in its issue workspace. Finish it there by hand and land it with the standalone wrap-up; a rerun skips it once it is closed.",
      ].join("\n\n"),
    );
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

function ticketStateOf(run: Run, ticket: IssueRef): TicketState {
  const key = issueLabelOf(ticket);
  run.state.tickets[key] ??= { step: "implement", sessions: [] };
  return run.state.tickets[key];
}

function isLaunchable(ticket: TrackedIssue): boolean {
  return ticket.isOpen && ticket.labels.includes(readyLabel);
}

function commandLabelOf(command: Command): string {
  return command.join(" ");
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

function bulletsOf(items: string[]): string {
  return items.map((item) => `- ${item}`).join("\n");
}
