// One ticket's run: takes its workspace lease, runs each step from the one it reached (implement or resume, review,
// resolve, checks) and lands it, releasing the lease however it ends. A Halt or a lease taken since the pick leaves
// the ticket waiting; an UnhandledStop leaves it unlanded and commented on, or Stops the run for a rerun to retry it.
// Before launch it raises a Failure Halt on a body ../IssueReader.ts doesn't trust; `approve` posts the text's approval.
// RunLoop.ts calls _runTicket and SessionReviewer.ts calls _runSteps.
// It builds its own LeaseKeeper, ImplementStepper, ReviewStepper, TicketLander and HaltRaiser.

import {
  failureAnswerOf,
  failureOptions,
  type Halt,
  haltNameOf,
  runnerMark,
  type StepFailure,
} from "../halts.ts";
import { approvalLineOf, bodyHashOf } from "../IssueReader.ts";
import { issueLabelOf, type IssueRef } from "../IssueWorkspaces.ts";
import { LeaseHeld } from "../LeaseHeld.ts";
import { pairLabelOf, pairOf } from "../modelFit.ts";
import { RunStop } from "../RunStop.ts";
import { SchemaFailure } from "../SchemaFailure.ts";
import { TicketHalted } from "../TicketHalted.ts";
import {
  rerunRetriedOutcomes,
  stopOutcomes,
  UnhandledStop,
} from "../UnhandledStop.ts";
import { HaltRaiser } from "./HaltRaiser.ts";
import { ImplementStepper } from "./ImplementStepper.ts";
import { LeaseKeeper } from "./LeaseKeeper.ts";
import { ReviewStepper } from "./ReviewStepper.ts";
import {
  deliverFailureHalts,
  haltsOfTicket,
  isAuthorshipHalt,
  isSameHeads,
  type LandingTicket,
  onlyDeveloperEditsTextOf,
  rerunCommandOf,
  type Run,
  targetsAtLaunchOf,
  type TicketOutcome,
  type TicketRun,
  type TicketState,
  ticketStateOf,
  type TicketStep,
  type TrackedIssue,
} from "./runState.ts";
import { SpecRunBase } from "./SpecRunBase.ts";
import { TicketLander } from "./TicketLander.ts";

export class TicketSequencer extends SpecRunBase {
  private get leaseKeeper(): LeaseKeeper {
    return new LeaseKeeper(this.config);
  }

  private get implementStepper(): ImplementStepper {
    return new ImplementStepper(this.config);
  }

  private get reviewStepper(): ReviewStepper {
    return new ReviewStepper(this.config);
  }

  private get ticketLander(): TicketLander {
    return new TicketLander(this.config);
  }

  private get haltRaiser(): HaltRaiser {
    return new HaltRaiser(this.config);
  }

  // An UnhandledStop leaves the ticket unlanded, commented on and noticed; a lease taken since the pick leaves it waiting.
  async _runTicket(run: Run, ticket: TrackedIssue): Promise<TicketOutcome> {
    const state = ticketStateOf(run, ticket.issue);
    try {
      // Delivered first, so a `rerun on <pair>` answer picks the pair.
      if (state.step === "halted") {
        const { extraTurns } = this.config.knobs;
        state.step =
          deliverFailureHalts(run, { ticket: ticket.issue, extraTurns }) ??
          "resume";
      }
      const pair = state.pair ?? pairOf(ticket.body);
      if (pair === undefined) {
        throw new UnhandledStop(
          "model-fit",
          "The ## Model fit section changed after preflight.",
          this._progressPathOf(run),
        );
      }
      await this._haltOnUntrustedBody({ run, ticket, pair, state });
      this._log(
        run,
        `${issueLabelOf(ticket.issue)}: launching on ${pairLabelOf(pair)} from ${state.step}.`,
      );
      if (state.step !== "wrap-up") {
        const workspace = await this._timed({ run, ticket }, "workspace", () =>
          this.leaseKeeper._workspaceFor(run, ticket.issue),
        );
        const targets = targetsAtLaunchOf(ticket, this._progressPathOf(run));
        await this._runSteps({ run, ticket, pair, workspace, state, targets });
      } else {
        const landing = this.workspaces.folderOf(ticket.issue);
        if (landing) await this.leaseKeeper._takeLease(run, landing);
      }
      await this._timed({ run, ticket }, "wrap-up", () =>
        this.ticketLander._land({ run, ticket, pair, state }),
      );
      return "landed";
    } catch (error) {
      if (error instanceof LeaseHeld) {
        this._log(run, `${issueLabelOf(ticket.issue)}: ${error.message}`);
        return "leased";
      }
      if (error instanceof TicketHalted) return "halted";
      // Only a run that dies mid-step leaves the marker, so an environment Stop never costs the step its retry.
      state.isStepStarted = undefined;
      this._saveState(run);
      if (!(error instanceof UnhandledStop)) throw error;
      if (isRerunRetried(error)) await this._stopForRerun(run, ticket, error);
      return await this._stopTicket(run, ticket, error);
    } finally {
      await this.leaseKeeper._releaseLeaseOf(ticket.issue);
    }
  }

  // Never quotes the body: a quote in a comment under the developer's login would read as Trusted text.
  private async _haltOnUntrustedBody(
    landingTicket: LandingTicket,
  ): Promise<void> {
    const { run, ticket, state } = landingTicket;
    const reason = await this._untrustedBodyReasonOf(ticket);
    if (reason === undefined) return;
    const bodyHash = bodyHashOf(ticket.body);
    const approving = approvingHaltOf(run, ticket.issue, bodyHash);
    if (approving !== undefined) {
      await this.config.github.comment(
        ticket.issue,
        `${runnerMark}\n${approvalLineOf(ticket.body)}\n\nApproved by answering ${haltNameOf(approving)} on ${issueLabelOf(run.spec.issue)}.`,
      );
      return;
    }
    const { approve, skip } = failureOptions;
    await this.haltRaiser._failureHalt(landingTicket, {
      step: state.step,
      detail: `${issueLabelOf(ticket.issue)}'s body was ${reason}. ${onlyDeveloperEditsTextOf(this.config.developer, "a ticket the run launches")}, unless they approve its text. Read the body and its edit history at ${ticket.url}; this Halt saw it as sha256:${bodyHash.slice(0, 12)}. An ${approve} posts the approval of that text on the ticket; a body changed since raises a fresh Halt instead, so to revert an edit, revert it, then ${approve} the fresh Halt. A ${skip} approves nothing.`,
      logPath: this._progressPathOf(run),
      options: [approve, skip],
      bodyHash,
    });
  }

  // Leaves the ticket at its step, so a rerun retries it.
  private async _stopForRerun(
    run: Run,
    ticket: TrackedIssue,
    stop: UnhandledStop,
  ): Promise<never> {
    const outcome = stopOutcomes[stop.outcome];
    const label = issueLabelOf(ticket.issue);
    const command = rerunCommandOf(this.config.githubOwner, run.spec.issue);
    const commentUrl = await this._comment(
      run,
      [
        stopHeadingOf(ticket, outcome),
        stop.message,
        `Log: \`${stop.logPath}\``,
        `The ticket is left at its ${ticketStateOf(run, ticket.issue).step} step in its issue workspace; rerun to retry it: \`${command}\`.`,
      ].join("\n\n"),
    );
    throw new RunStop(`Stopped on ${label}: ${outcome}; rerun to retry it.`, {
      ticket: ticket.issue,
      commentUrl,
    });
  }

  private async _stopTicket(
    run: Run,
    ticket: TrackedIssue,
    stop: UnhandledStop,
  ): Promise<never> {
    const state = ticketStateOf(run, ticket.issue);
    const outcome = stopOutcomes[stop.outcome];
    state.step = "stopped";
    state.stop = outcome;
    this._saveState(run);
    this._log(
      run,
      `${issueLabelOf(ticket.issue)}: stopped on ${outcome}; details in the spec-issue comment.`,
    );
    const commentUrl = await this._comment(
      run,
      [
        stopHeadingOf(ticket, outcome),
        stop.message,
        `Log: \`${stop.logPath}\``,
        "The ticket is left unlanded in its issue workspace, and a rerun won't retry it. Finish and land it by hand with the standalone wrap-up; a rerun skips it once it is closed.",
      ].join("\n\n"),
    );
    throw new RunStop(`Stopped on ${issueLabelOf(ticket.issue)}: ${outcome}.`, {
      ticket: ticket.issue,
      commentUrl,
    });
  }

  // An implementer whose record failed after it committed is offered `retry record`, which keeps those commits.
  async _runSteps(ticketRun: TicketRun): Promise<void> {
    try {
      await this._runEachStep(ticketRun);
    } catch (error) {
      if (!(error instanceof SchemaFailure)) throw error;
      const { workspace, state } = ticketRun;
      const base = state.implementBase;
      const isImplement = state.step === "implement" || state.step === "resume";
      const failure: StepFailure = {
        step: state.step,
        detail: error.message,
        logPath: error.logPath,
      };
      if (
        isImplement &&
        base !== undefined &&
        !isSameHeads(base, await this._headsOf(workspace))
      ) {
        failure.options = [failureOptions.retryRecord, failureOptions.retry];
      }
      await this.haltRaiser._failureHalt(ticketRun, failure);
    }
  }

  private async _runEachStep(ticketRun: TicketRun): Promise<void> {
    const { run, state } = ticketRun;
    if (state.isStepStarted) {
      await this.haltRaiser._takeCrash(ticketRun, {
        detail: `The run ended during the ${state.step} step.`,
        logPath: this._progressPathOf(run),
      });
    }
    if (state.step === "implement") {
      this._markStepStarted(ticketRun);
      await this._timed(ticketRun, "implement", () =>
        this.implementStepper._implement(ticketRun),
      );
      // A ticket with no code has nothing to review or check.
      const next = state.record?.status === "applied" ? "wrap-up" : "review";
      this._advance(ticketRun, next);
    }
    if (state.step === "resume") {
      this._markStepStarted(ticketRun);
      await this._timed(ticketRun, "resume", () =>
        this.implementStepper._resume(ticketRun),
      );
      this._advance(ticketRun, stepAfterResumeOf(state));
    }
    if (state.step === "review") {
      this._markStepStarted(ticketRun);
      await this._timed(ticketRun, "review", () =>
        this.reviewStepper._review(ticketRun),
      );
      const hasFindings = (state.findings ?? []).length > 0;
      this._advance(ticketRun, hasFindings ? "resolve" : "checks");
    }
    // Checks run after the resolve, so a fix that turns them red gets the red-checks resume.
    if (state.step === "resolve") {
      this._markStepStarted(ticketRun);
      await this._timed(ticketRun, "resolve", () =>
        this.reviewStepper._resolve(ticketRun),
      );
      this._advance(ticketRun, "checks");
    }
    if (state.step === "checks") {
      // A session's review leaves the checks and wrap-up to the session.
      if (run.sessionReview !== undefined) return;
      await this.haltRaiser._haltOnUnpostedHalts(ticketRun);
      await this._timed(ticketRun, "checks", () =>
        this.ticketLander._check(ticketRun),
      );
      this._advance(ticketRun, "wrap-up");
    }
  }
}

// A ticket halted before review has nothing reviewed yet; one with no code has nothing to review.
function stepAfterResumeOf(state: TicketState): TicketStep {
  if (state.record?.status === "applied") return "wrap-up";
  return state.findings === undefined ? "review" : "checks";
}

// Only the latest authorship Halt's answer counts, and only for the text that Halt saw.
function approvingHaltOf(
  run: Run,
  ticket: IssueRef,
  bodyHash: string,
): Halt | undefined {
  const latest = haltsOfTicket(run, ticket).findLast(isAuthorshipHalt);
  if (latest?.answer === undefined || latest.bodyHash !== bodyHash) {
    return undefined;
  }
  const isApproved = failureAnswerOf(latest, latest.answer).kind === "approve";
  return isApproved ? latest : undefined;
}

function isRerunRetried({ outcome }: UnhandledStop): boolean {
  return rerunRetriedOutcomes.includes(outcome);
}

function stopHeadingOf(ticket: TrackedIssue, outcome: string): string {
  return `The runner stopped on ${issueLabelOf(ticket.issue)}, "${ticket.title}": ${outcome}.`;
}
