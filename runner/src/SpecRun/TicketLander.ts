// A ticket's checks and landing. Checks run in the workspace until green, resuming whoever made the last commit on red;
// a red master Stops the run. Landing writes the facts file, runs the wrap-up, on a conflict starts a merge of master and
// resumes the implementer once to resolve it, and posts the ticket's review list, that merge's resolution on it as a Propose `decision`.
// TicketSequencer.ts calls _check after the resolve step and _land at wrap-up.
// It builds its own ReviewStepper, ReviewListPoster and HaltRaiser; prompts are ../redChecksStep.ts and ../mergeMasterStep.ts.

import { type WrapUpFacts } from "../FactsFile.ts";
import { commandLabelOf, messageOf } from "../failureText.ts";
import { git, isMerging } from "../git.ts";
import { haltKindLabelOf } from "../halts.ts";
import { issueLabelOf } from "../IssueWorkspaces.ts";
import {
  mergeMasterOutputSchema,
  mergeMasterPrompt,
  type MergeMasterRecord,
} from "../mergeMasterStep.ts";
import { pairLabelOf } from "../modelFit.ts";
import { redChecksOutputSchema, redChecksPrompt } from "../redChecksStep.ts";
import { RunStop } from "../RunStop.ts";
import { SchemaFailure } from "../SchemaFailure.ts";
import { type RecordedSession, unrecordedFactsOf } from "../transcriptFacts.ts";
import { UnhandledStop } from "../UnhandledStop.ts";
import { WrapUpFailure } from "../WrapUpFailure.ts";
import { HaltRaiser } from "./HaltRaiser.ts";
import { ReviewListPoster } from "./ReviewListPoster.ts";
import { ReviewStepper } from "./ReviewStepper.ts";
import {
  type LandingTicket,
  type RanStep,
  type Resolver,
  runCommand,
  targetsAtLaunchOf,
  type TicketRun,
  type TicketState,
} from "./runState.ts";
import { runHalts } from "./runState/runHalts.ts";
import { ticketSteps } from "./runState/ticketSteps.ts";
import { type CloneWorktree, SpecRunBase } from "./SpecRunBase.ts";

const resolverLabels: Record<Resolver, string> = {
  implementer: "implementer",
  fresh: "fresh resolver",
};

export class TicketLander extends SpecRunBase {
  private get haltRaiser(): HaltRaiser {
    return new HaltRaiser(this.config);
  }

  private get reviewStepper(): ReviewStepper {
    return new ReviewStepper(this.config);
  }

  private get reviewListPoster(): ReviewListPoster {
    return new ReviewListPoster(this.config);
  }

  async _check(ticketRun: TicketRun): Promise<void> {
    for (;;) {
      const failure = await this._redChecksOf(ticketRun);
      if (failure === undefined) return;
      await this._resumeOnRedChecks(ticketRun, failure);
    }
  }

  // The first failing check's command and output tail; undefined when all pass. A red master Stops the run.
  private async _redChecksOf(
    ticketRun: TicketRun,
  ): Promise<string | undefined> {
    for (const command of this.config.knobs.checks) {
      this._log(
        ticketRun.run,
        `${issueLabelOf(ticketRun.ticket.issue)}: checking ${commandLabelOf(command)}.`,
      );
      const failure = await runCommand(command, ticketRun.workspace.path);
      if (failure !== undefined) {
        await this._stopOnRedMaster(ticketRun);
        return `${commandLabelOf(command)} failed:\n${failure}`;
      }
    }
    return undefined;
  }

  // Whoever made the last commit gets the failure, the fresh resolver in place of an implementer past the ticket budget.
  private async _resumeOnRedChecks(
    ticketRun: TicketRun,
    failure: string,
  ): Promise<void> {
    const { run, ticket, workspace, state } = ticketRun;
    const { retriesPerFailure } = this.config.knobs;
    const resumes = state.redCheckResumes ?? 0;
    if (resumes >= retriesPerFailure) {
      await this.haltRaiser._failureHalt(ticketRun, {
        step: "checks",
        detail: `The checks are still red after ${resumes} resume(s): ${failure}`,
        logPath: state.redChecksLogPath ?? this._progressPathOf(run),
      });
    }
    state.redCheckResumes = resumes + 1;
    this._saveState(run);
    let resolver: Resolver = state.resolver ?? "implementer";
    if (resolver === "implementer" && !this._isUnderBudget(state)) {
      resolver = "fresh";
    }
    this._log(
      run,
      `${issueLabelOf(ticket.issue)}: checks red; resuming the ${resolverLabels[resolver]} with the failure.`,
    );
    this._markStepStarted(ticketRun);
    const { result, logPath } = await this.reviewStepper._runResolverStep(
      ticketRun,
      {
        step: "red-checks",
        resolver,
        launch: {
          prompt: redChecksPrompt({
            issue: ticket.issue,
            title: ticket.title,
            branch: workspace.branch,
            branchedRepos: ticketSteps.branchedReposOf(ticketRun),
            failures: failure,
          }),
          jsonSchema: redChecksOutputSchema,
        },
      },
    );
    state.redChecksLogPath = logPath;
    state.isStepStarted = undefined;
    this._saveState(run);
    // The checks loop judges what a capped resolver committed.
    if (ticketSteps.isTurnCapped(result)) {
      await this._snapshot(ticketRun, "checks");
      return;
    }
    ticketSteps.recordOf("resolve", result, logPath);
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
  async _land(landingTicket: LandingTicket): Promise<void> {
    const { run, ticket, state } = landingTicket;
    const steps = ticketSteps.recordedSessionsOf(state);
    this._writeFacts(landingTicket, steps);
    this._warnOnUnrecordedFacts(landingTicket, steps);
    this._log(run, `${issueLabelOf(ticket.issue)}: wrapping up.`);
    for (;;) {
      try {
        await this.wrapUp.run(ticket.issue);
        break;
      } catch (error) {
        await this._takeWrapUpFailure(landingTicket, error);
        // A merge-master resume adds an item to the review list, which the rerun's close step reads.
        this.factsFile.setReviewFacts(
          ticket.issue,
          ticketSteps.reviewFactsOf(state),
        );
      }
    }
    this._advance(landingTicket, "landed");
    this._log(run, `${issueLabelOf(ticket.issue)}: landed.`);
    await this.reviewListPoster._postReviewList(run, ticket);
  }

  // Returns only after the merge-master resume, so the wrap-up runs again; a network failure was already retried with backoff.
  private async _takeWrapUpFailure(
    landingTicket: LandingTicket,
    error: unknown,
  ): Promise<void> {
    const { run, state } = landingTicket;
    const logPath = this._progressPathOf(run);
    if (!(error instanceof WrapUpFailure) || error.kind === "network") {
      throw new UnhandledStop("wrap-up-failure", messageOf(error), logPath);
    }
    const resumes = state.conflictResumes ?? 0;
    if (error.kind === "conflict" && resumes === 0) {
      state.conflictResumes = resumes + 1;
      this._saveState(run);
      await this._mergeMaster(landingTicket, error.message);
      return;
    }
    let detail = error.message;
    if (error.kind === "conflict") {
      // Its resolution never landed, so a ticket landed some other way after the Halt doesn't show it.
      state.mergeMasterRecord = undefined;
      state.unrecordedMerge = undefined;
      this._saveState(run);
      detail = `The wrap-up still conflicts after the merge-master resume: ${detail}`;
    }
    await this.haltRaiser._failureHalt(landingTicket, {
      step: "wrap-up",
      detail,
      logPath,
    });
  }

  // The rerun wrap-up judges what the session merged, so a turn cap only sets its uncommitted work aside.
  // The runner starts the merge because the step's sandbox blocks a git write to `.claude/` files.
  private async _mergeMaster(
    landingTicket: LandingTicket,
    conflict: string,
  ): Promise<void> {
    const { run, ticket } = landingTicket;
    const progressPath = this._progressPathOf(run);
    const workspace = await this.workspaces.find(ticket.issue);
    if (workspace === undefined) {
      throw new UnhandledStop(
        "workspace",
        `${issueLabelOf(ticket.issue)}'s workspace is gone, so master can't be merged into its branch.`,
        progressPath,
      );
    }
    const ticketRun: TicketRun = {
      ...landingTicket,
      workspace,
      targets: targetsAtLaunchOf(ticket, progressPath),
    };
    const branchedRepos = ticketSteps.branchedReposOf(ticketRun);
    const worktrees = this._worktreesOf(workspace).filter(({ repo }) =>
      branchedRepos.includes(repo),
    );
    let ran: RanStep;
    try {
      const mergingRepos = await this._startMerges(ticketRun, worktrees);
      if (mergingRepos.length === 0) {
        this._log(
          run,
          `${issueLabelOf(ticket.issue)}: the wrap-up conflicted with master, which then merged cleanly; rerunning the wrap-up.`,
        );
        return;
      }
      this._log(
        run,
        `${issueLabelOf(ticket.issue)}: the wrap-up conflicted with master; resuming the implementer to merge it.`,
      );
      ran = await this.reviewStepper._runResolverStep(ticketRun, {
        step: "merge-master",
        resolver: "implementer",
        launch: {
          prompt: mergeMasterPrompt({
            issue: ticket.issue,
            title: ticket.title,
            branch: workspace.branch,
            branchedRepos,
            mergingRepos,
            conflict,
          }),
          jsonSchema: mergeMasterOutputSchema,
        },
      });
      this._saveState(run);
      // Before the abort, which would discard the session's partial resolution.
      if (ticketSteps.isTurnCapped(ran.result)) {
        await this._snapshot(ticketRun, "wrap-up");
      }
    } finally {
      await abortMerges(worktrees);
    }
    await this._takeMergeMasterResult(landingTicket, ran);
  }

  // Returns the repos left mid-merge with conflicts; a repo that merged cleanly has its merge committed.
  private async _startMerges(
    ticketRun: TicketRun,
    worktrees: CloneWorktree[],
  ): Promise<string[]> {
    const mergingRepos: string[] = [];
    for (const { repo, worktree } of worktrees) {
      try {
        await git(worktree, "merge", "--no-edit", "master");
      } catch (error) {
        if (!(await isMerging(worktree))) {
          await this.haltRaiser._failureHalt(ticketRun, {
            step: "wrap-up",
            detail: `Merging master into ${repo}'s ticket branch failed: ${messageOf(error)}`,
            logPath: this._progressPathOf(ticketRun.run),
          });
        }
        mergingRepos.push(repo);
      }
    }
    return mergingRepos;
  }

  private async _takeMergeMasterResult(
    landingTicket: LandingTicket,
    { result, logPath }: RanStep,
  ): Promise<void> {
    const { run, state } = landingTicket;
    if (ticketSteps.isTurnCapped(result)) {
      // It may have committed its merge first, which the rerun wrap-up then lands.
      state.unrecordedMerge =
        "The merge-master session hit its turn cap before returning its record.";
      this._saveState(run);
      return;
    }
    let record: MergeMasterRecord;
    try {
      record = ticketSteps.recordOf(
        "merge-master",
        result,
        logPath,
      ) as MergeMasterRecord;
    } catch (error) {
      if (!(error instanceof SchemaFailure)) throw error;
      state.unrecordedMerge = `The merge-master session's record failed its checks: ${error.message}`;
      this._saveState(run);
      return this.haltRaiser._failureHalt(landingTicket, {
        step: "wrap-up",
        detail: error.message,
        logPath: error.logPath,
      });
    }
    if (record.unsure !== undefined) {
      state.mergeMasterRecord = undefined;
      state.unrecordedMerge = undefined;
      this._saveState(run);
      return this.haltRaiser._failureHalt(landingTicket, {
        step: "wrap-up",
        detail: `The merge-master step couldn't tell how to resolve the conflict with master: ${record.unsure}`,
        logPath,
      });
    }
    state.mergeMasterRecord = record;
    state.unrecordedMerge = undefined;
    this._saveState(run);
  }

  private _writeFacts(
    { run, ticket, pair, state }: LandingTicket,
    steps: RecordedSession[],
  ): void {
    const { record } = state;
    if (record === undefined) {
      throw new Error(
        `${issueLabelOf(ticket.issue)} reached its wrap-up with no implement record`,
      );
    }
    const facts: WrapUpFacts = {
      closingComment: record.closingComment,
      boxesUndone: record.boxesUndone,
      ...ticketSteps.reviewFactsOf(state),
      reviewRounds: 1,
      retries: retriesOf(state),
      pair: pairLabelOf(pair),
    };
    const haltKinds = new Set(
      runHalts
        .ofTicket(run, ticket.issue)
        .map(({ kind }) => haltKindLabelOf(kind)),
    );
    if (haltKinds.size > 0) facts.halt = [...haltKinds].join(", ");
    if (record.status === "applied") {
      facts.reviewFixes = "skipped";
      facts.reviewRounds = 0;
      facts.githubWrites = record.githubWrites;
    }
    if (steps.length > 0) facts.sessions = { steps };
    this.factsFile.write(ticket.issue, facts);
  }

  // So a regression in the session facts shows on the first ticket it hits, not in a later audit of the rows.
  private _warnOnUnrecordedFacts(
    { run, ticket, state }: LandingTicket,
    steps: RecordedSession[],
  ): void {
    const prefix = `${issueLabelOf(ticket.issue)}: warning:`;
    const dropped = state.sessions.length - steps.length;
    if (dropped > 0) {
      this._log(
        run,
        `${prefix} ${dropped} step session(s) left out of the facts file, saved with no account or config folder.`,
      );
    }
    if (steps.length === 0) return;
    unrecordedFactsOf({ steps }).forEach(({ label, reason }) => {
      this._log(run, `${prefix} ${label} written unrecorded: ${reason}.`);
    });
  }
}

async function abortMerges(worktrees: CloneWorktree[]): Promise<void> {
  for (const { worktree } of worktrees) {
    if (await isMerging(worktree)) await git(worktree, "merge", "--abort");
  }
}

function retriesOf({ crashes = {}, redCheckResumes = 0 }: TicketState): number {
  return Object.values(crashes).reduce(
    (sum, count) => sum + count,
    redCheckResumes,
  );
}
