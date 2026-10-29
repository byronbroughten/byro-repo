// The Base every SpecRun collaborator extends: the run's config, the run-state file, the progress log and notices,
// the spec comment, the step timer, the usage reading and the git snapshots that back up a workspace's uncommitted work.
// It holds every helper more than one collaborator calls, and imports no collaborator, so `extends SpecRunBase` loads first.
// Its members are protected so the coordinator and every collaborator reach them, and each keeps its `_` prefix.
// The run's types and shared module functions are runState.ts; the coordinator callers build is ../SpecRun.ts.

import {
  appendFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";

import { ActiveAccountUnknown } from "../ActiveAccountUnknown.ts";
import type { AgentStep } from "../AgentStep.ts";
import { FactsFile } from "../FactsFile.ts";
import { messageOf } from "../failureText.ts";
import {
  dirtyReposOf,
  git,
  saveUncommitted,
  snapshotUncommitted,
  worktreeStateOf,
} from "../git.ts";
import { runnerMark } from "../halts.ts";
import { approvalLineOf, untrustedBodyReasonOf } from "../IssueReader.ts";
import {
  issueLabelOf,
  type IssueRef,
  IssueWorkspaces,
  type IssueWorkspacesConfig,
  type Workspace,
} from "../IssueWorkspaces.ts";
import {
  type AccountReading,
  type LimitGuardKnobs,
  type UsageList,
  type UsageReader,
} from "../limitGuard.ts";
import type { Notice, Notices } from "../Notices.ts";
import { stepTookLineOf } from "../progressLines.ts";
import type { RunKnobs } from "../runKnobs.ts";
import { runStateOf } from "../savedFormats.ts";
import { sleep } from "../sleep.ts";
import { WrapUp, type WrapUpGitHub, type WrapUpKnobs } from "../WrapUp.ts";
import {
  type Heads,
  type IssueComment,
  isTreeKept,
  type LandingTicket,
  onlyDeveloperEditsTextOf,
  progressLogPathOf,
  rerunCommandOf,
  type Run,
  type RunResult,
  type RunState,
  runStatePathOf,
  type TicketRun,
  type TicketState,
  type TicketStep,
  type TrackedIssue,
  type Wait,
} from "./runState.ts";

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

export interface RunGitHub extends WrapUpGitHub {
  issueOf(issue: IssueRef): Promise<TrackedIssue>;
  // In sub-issue order.
  subIssuesOf(issue: IssueRef): Promise<IssueRef[]>;
  // The issues still open among those natively marked as blocking it.
  openBlockersOf(issue: IssueRef): Promise<IssueRef[]>;
  // Resolves to the comment's URL.
  comment(issue: IssueRef, body: string): Promise<string>;
  // Oldest first.
  authoredCommentsOf(issue: IssueRef): Promise<IssueComment[]>;
}

// What an announced event adds to its notice beyond the spec and summary.
export type RunEvent = Pick<
  Notice,
  "kind" | "ticket" | "commentUrl" | "warnings"
>;

export interface Clock {
  now(): Date;
}

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

export class SpecRunBase {
  protected readonly config: SpecRunConfig;

  constructor(config: SpecRunConfig) {
    this.config = config;
  }

  get workspaces(): IssueWorkspaces {
    return IssueWorkspaces.init(this._workspacesConfig);
  }

  get factsFile(): FactsFile {
    return FactsFile.init(this.config.stateFolder);
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

  protected get _workspacesConfig(): IssueWorkspacesConfig {
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

  protected get _sleep(): (ms: number) => Promise<void> {
    return this.config.sleep ?? sleep;
  }

  protected async _startRun(specIssue: IssueRef): Promise<Run> {
    return this._runOf(specIssue, this._readState(specIssue));
  }

  protected async _runOf(specIssue: IssueRef, state: RunState): Promise<Run> {
    const spec = await this.config.github.issueOf(specIssue);
    const subIssues = await this.config.github.subIssuesOf(specIssue);
    mkdirSync(this.config.stateFolder, { recursive: true });
    return {
      spec,
      tickets: subIssues.length > 0 ? subIssues : [specIssue],
      isTicketless: subIssues.length === 0,
      state,
      landed: [],
      warnings: new Set(),
      skipped: new Set(),
      failureStreak: [],
    };
  }

  protected _readState(spec: IssueRef): RunState {
    const path = this._statePathOf(spec);
    if (!existsSync(path)) return { tickets: {} };
    return runStateOf(JSON.parse(readFileSync(path, "utf8")));
  }

  protected _statePathOf(spec: IssueRef): string {
    return runStatePathOf(this.config.stateFolder, spec);
  }

  protected _saveState(run: Run): void {
    if (run.sessionReview !== undefined) return;
    writeFileSync(
      this._statePathOf(run.spec.issue),
      `${JSON.stringify(run.state, undefined, 2)}\n`,
    );
  }

  // A halted step that passes with no agent launch, as green checks do, drops its guidance.
  protected _advance({ run, state }: LandingTicket, step: TicketStep): void {
    state.step = step;
    state.guidance = undefined;
    state.isStepStarted = undefined;
    this._saveState(run);
  }

  protected _markStepStarted({ run, state }: TicketRun): void {
    state.isStepStarted = true;
    this._saveState(run);
  }

  // A ticket whose implementer has no recorded peak counts as over budget.
  protected _isUnderBudget(state: TicketState): boolean {
    const peak = state.implementPeak ?? Infinity;
    return peak < this.config.knobs.ticketBudget;
  }

  // Usage is undefined when the read gives none for the Active account.
  protected async _activeReadingOf(run: Run): Promise<AccountReading> {
    const list = await this._usageListOf(run);
    const account = list?.activeAccount;
    if (account === undefined) throw new ActiveAccountUnknown();
    const usage = list?.readings.find((r) => r.account === account)?.usage;
    return { account, usage };
  }

  private async _usageListOf(run: Run): Promise<UsageList | undefined> {
    try {
      return await this.config.usageReader.read();
    } catch (error) {
      this._log(run, `The usage read failed: ${messageOf(error)}`);
      return undefined;
    }
  }

  // Logged however the step ends, a Stop or Halt included.
  protected async _timed<RV>(
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
        stepTookLineOf(ticket.issue, step, this._secondsSince(startedAt)),
      );
    }
  }

  protected _secondsSince(startedAt: Date): number {
    const ms = this.config.clock.now().getTime() - startedAt.getTime();
    return Math.round(ms / 1000);
  }

  // Marked, since the runner posts as the developer's login and must never read its own comment as an answer.
  protected async _comment(run: Run, body: string): Promise<string> {
    return this.config.github.comment(run.spec.issue, `${runnerMark}\n${body}`);
  }

  protected _withRerunLine(run: Run, message: string, waits: Wait[]): string {
    if (!waits.some(({ reason }) => reason === "developer")) return message;
    const command = rerunCommandOf(this.config.githubOwner, run.spec.issue);
    return `${message} Rerun once your tickets close: \`${command}\`.`;
  }

  // Printed to the terminal only: a developer-login comment quoting the approval line would itself approve the body.
  protected async _authorshipRefusal(
    subject: string,
    issues: TrackedIssue[],
  ): Promise<string | undefined> {
    const reasons = await Promise.all(
      issues.map((issue) => this._untrustedBodyReasonOf(issue)),
    );
    const refused = issues.flatMap((issue, index) => {
      const reason = reasons[index];
      return reason === undefined ? [] : [{ issue, reason }];
    });
    if (refused.length === 0) return undefined;
    const offenders = refused.map(
      ({ issue, reason }) => `${issueLabelOf(issue.issue)} (${reason})`,
    );
    const approvals = refused.map(
      ({ issue }) =>
        `${issueLabelOf(issue.issue)}:\n${approvalLineOf(issue.body)}`,
    );
    return `${onlyDeveloperEditsTextOf(this.config.developer, subject)}; refused ${offenders.join(", ")}. For the developer to paste after reading the body, as a comment on it; an agent never posts this line.\n\n${approvals.join("\n\n")}`;
  }

  // Its comments are read only when its edit history alone leaves the body untrusted.
  protected async _untrustedBodyReasonOf(
    issue: TrackedIssue,
  ): Promise<string | undefined> {
    const { developer, github } = this.config;
    if (
      untrustedBodyReasonOf(developer, { ...issue, comments: [] }) === undefined
    ) {
      return undefined;
    }
    const comments = await github.authoredCommentsOf(issue.issue);
    return untrustedBodyReasonOf(developer, { ...issue, comments });
  }

  protected async _end(
    run: Run,
    kind: "finished" | "stopped",
    message: string,
    event: RunEvent = {},
  ): Promise<RunResult> {
    await this._announce(run, message, { ...event, kind });
    return { kind, landed: run.landed, message };
  }

  // A notice that fails is logged, not thrown: the comment and the progress log still hold the event.
  protected async _announce(
    run: Run,
    summary: string,
    event: RunEvent = {},
  ): Promise<void> {
    this._log(run, summary);
    // A session's review prints to the session instead.
    if (run.sessionReview !== undefined) return;
    try {
      await this.config.notices.send({
        spec: run.spec.issue,
        specTitle: run.spec.title,
        summary,
        link: run.spec.url,
        ...event,
      });
    } catch (error) {
      this._log(run, `The notice failed: ${messageOf(error)}`);
    }
  }

  // Newlines are folded so each event stays one line for tail -f.
  protected _log(run: Run, line: string): void {
    this._record(run, line);
    this.config.log?.(line);
  }

  // To the progress file alone, for a line its caller returns to print.
  protected _record(run: Run, line: string): void {
    const oneLine = line.replace(/\s*\n\s*/g, " ");
    appendFileSync(
      this._progressPathOf(run),
      `${this.config.clock.now().toISOString()} ${oneLine}\n`,
    );
  }

  protected _progressPathOf(run: Run): string {
    return progressLogPathOf(this.config.stateFolder, run.spec.issue);
  }

  // Each dirty worktree's uncommitted work goes to a backup branch, and the tree back to its last commit unless a handoff's next step needs it.
  protected async _snapshot(
    ticketRun: TicketRun,
    step: TicketStep,
  ): Promise<void> {
    const save = isTreeKept(ticketRun.state)
      ? saveUncommitted
      : snapshotUncommitted;
    await this._backUp(ticketRun, step, save);
  }

  protected async _backUp(
    { run, ticket, workspace }: TicketRun,
    suffix: string,
    save: typeof saveUncommitted,
  ): Promise<void> {
    for (const { repo, worktree } of this._worktreesOf(workspace)) {
      const branch = await save(
        worktree,
        `backup/${workspace.branch}-${suffix}`,
      );
      if (branch === undefined) continue;
      this._log(
        run,
        `${issueLabelOf(ticket.issue)}: saved ${repo}'s uncommitted work to ${branch}.`,
      );
    }
  }

  // Every repo's HEAD, so any commit in any repo changes it.
  protected async _headsOf(workspace: Workspace): Promise<Heads> {
    const entries = await Promise.all(
      this._worktreesOf(workspace).map(
        async ({ clonePath, worktree }) =>
          [clonePath, await git(worktree, "rev-parse", "HEAD")] as const,
      ),
    );
    return Object.fromEntries(entries);
  }

  protected _worktreesOf(workspace: Workspace): CloneWorktree[] {
    return Object.entries(this.config.knobs.clonePaths).flatMap(
      ([repo, clonePath]) => {
        const worktree = join(workspace.path, clonePath);
        return existsSync(worktree) ? [{ repo, clonePath, worktree }] : [];
      },
    );
  }

  protected async _headsAndDirtyReposOf(
    workspace: Workspace,
  ): Promise<HeadsAndDirtyRepos> {
    const worktrees = await Promise.all(
      this._worktreesOf(workspace).map(async (clone) => ({
        ...clone,
        state: await worktreeStateOf(clone.worktree),
      })),
    );
    const heads: Heads = Object.fromEntries(
      worktrees.map(({ clonePath, state }) => [clonePath, state.head]),
    );
    return { heads, dirtyRepos: dirtyReposOf(worktrees) };
  }
}
