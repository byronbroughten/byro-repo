// A ticket's landing. It writes the facts file, runs the wrap-up, on a conflict starts a merge of master and
// resumes the implementer once to resolve it, and posts the ticket's review list, that merge's resolution on it as a Propose `decision`.
// TicketSequencer.ts calls _check after the resolve step and _land at wrap-up.
// _check only delegates: a ticket's checks are TicketLander/TicketChecker.ts.
// It builds its own TicketChecker, ReviewStepper, ReviewListPoster and HaltRaiser; the prompt is ../mergeMasterStep.ts.

import { type WrapUpFacts } from "../FactsFile.ts";
import { messageOf } from "../failureText.ts";
import { git, isMerging } from "../git.ts";
import { haltKindLabelOf } from "../halts.ts";
import { issueLabelOf } from "../IssueWorkspaces.ts";
import {
  mergeMasterOutputSchema,
  mergeMasterPrompt,
  type MergeMasterRecord,
} from "../mergeMasterStep.ts";
import { pairLabelOf } from "../modelFit.ts";
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
  targetsAtLaunchOf,
  type TicketRun,
  type TicketState,
} from "./runState.ts";
import { runHalts } from "./runState/runHalts.ts";
import { ticketSteps } from "./runState/ticketSteps.ts";
import { type CloneWorktree, SpecRunBase } from "./SpecRunBase.ts";
import { TicketChecker } from "./TicketLander/TicketChecker.ts";

export class TicketLander extends SpecRunBase {
  private get ticketChecker(): TicketChecker {
    return new TicketChecker(this.config);
  }

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
    return this.ticketChecker._check(ticketRun);
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
    const conflicted = `${issueLabelOf(ticket.issue)}: the wrap-up conflicted with master`;
    let ran: RanStep;
    try {
      // From the runner's own process, since the step's sandbox blocks a git write to `.claude/` files.
      const mergingRepos = await this._startMerges(ticketRun, worktrees);
      if (mergingRepos.length === 0) {
        this._log(
          run,
          `${conflicted}, which then merged cleanly; rerunning the wrap-up.`,
        );
        return;
      }
      this._log(run, `${conflicted}; resuming the implementer to merge it.`);
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
          // A crash's snapshot resets the tree, which ends the merge the retry is told is in progress.
          beforeCrashRetry: async () => {
            await this._startMerges(ticketRun, worktrees);
          },
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
