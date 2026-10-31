// A ticket's checks and landing. Checks run in the workspace until green, resuming whoever made the last commit on red;
// a red master Stops the run. Landing writes the facts file, runs the wrap-up, resumes the implementer once to merge master
// on a conflict, and posts the ticket's review list, that merge's resolution on it as a Propose `decision`.
// TicketSequencer.ts calls _check after the resolve step and _land at wrap-up.
// It builds its own ReviewStepper, ReviewListPoster and HaltRaiser; prompts are ../redChecksStep.ts and ../mergeMasterStep.ts.

import { type WrapUpFacts } from "../FactsFile.ts";
import { commandLabelOf, messageOf } from "../failureText.ts";
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
  branchedReposOf,
  haltsOfTicket,
  isTurnCapped,
  type LandingTicket,
  recordedSessionsOf,
  recordOf,
  type Resolver,
  reviewFactsOf,
  runCommand,
  targetsAtLaunchOf,
  type TicketRun,
  type TicketState,
} from "./runState.ts";
import { SpecRunBase } from "./SpecRunBase.ts";

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
            branchedRepos: branchedReposOf(ticketRun),
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
    if (isTurnCapped(result)) {
      await this._snapshot(ticketRun, "checks");
      return;
    }
    recordOf("resolve", result, logPath);
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
    const steps = recordedSessionsOf(state);
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
        this.factsFile.setReviewFacts(ticket.issue, reviewFactsOf(state));
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
    this._log(
      run,
      `${issueLabelOf(ticket.issue)}: the wrap-up conflicted with master; resuming the implementer to merge it.`,
    );
    const { result, logPath } = await this.reviewStepper._runResolverStep(
      ticketRun,
      {
        step: "merge-master",
        resolver: "implementer",
        launch: {
          prompt: mergeMasterPrompt({
            issue: ticket.issue,
            title: ticket.title,
            branch: workspace.branch,
            branchedRepos: branchedReposOf(ticketRun),
            conflict,
          }),
          jsonSchema: mergeMasterOutputSchema,
        },
      },
    );
    this._saveState(run);
    if (isTurnCapped(result)) {
      // It may have committed its merge first, which the rerun wrap-up then lands.
      landingTicket.state.unrecordedMerge =
        "The merge-master session hit its turn cap before returning its record.";
      this._saveState(run);
      await this._snapshot(ticketRun, "wrap-up");
      return;
    }
    try {
      landingTicket.state.mergeMasterRecord = recordOf(
        "merge-master",
        result,
        logPath,
      ) as MergeMasterRecord;
      landingTicket.state.unrecordedMerge = undefined;
      this._saveState(run);
    } catch (error) {
      if (!(error instanceof SchemaFailure)) throw error;
      landingTicket.state.unrecordedMerge = `The merge-master session's record failed its checks: ${error.message}`;
      this._saveState(run);
      await this.haltRaiser._failureHalt(landingTicket, {
        step: "wrap-up",
        detail: error.message,
        logPath: error.logPath,
      });
    }
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
      ...reviewFactsOf(state),
      reviewRounds: 1,
      retries: retriesOf(state),
      pair: pairLabelOf(pair),
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

function retriesOf({ crashes = {}, redCheckResumes = 0 }: TicketState): number {
  return Object.values(crashes).reduce(
    (sum, count) => sum + count,
    redCheckResumes,
  );
}
