// The review lists and the gap check. At landing a ticket with resolve records or a merge-master record gets one review-list comment on the spec and each
// covered-later Dismiss a note on its later ticket, each checked for its marker first; once the run has no ticket left to work, _finish
// posts any review list a killed run missed and runs the spec-end Steps its Workflow supplies when the Workflow's trigger finds them due: the gap check, whose gaps become the last review list,
// and the judge Step, which ends a run holding undecided items with "judge, then rerun".
// RunLoop.ts calls _finish; SessionReviewer.ts calls _runnersSpecCommentsOf, _postCoveredLaterNotes and _postSessionReviewList,
// which edits a posted list in place where a re-review's differs, the Base skipping a session's push; TicketLander.ts calls _postReviewList at landing;
// StatusReporter.ts calls _isGapChecked.
// It builds its own StepLauncher and HaltRaiser; formats are ../reviewList.ts, the gap check's prompt the spec's Workflow's, through ../Workflow.ts.

import {
  failureHaltOf,
  guidanceSectionOf,
  isAnswered,
  isRunnersComment,
  runnerMark,
  type StepFailure,
} from "../halts.ts";
import { type FailureAnswer, haltReplies } from "../halts/haltReplies.ts";
import { type IssueRef, issueRef } from "../IssueWorkspaces.ts";
import {
  coveredLaterNotesOf,
  gapCheckListOf,
  gapCheckSubject,
  isDevelopersReviewList,
  reReviewedCommentOf,
  reviewListMarkOf,
  type ReviewListSubject,
  ticketPushOf,
  ticketReviewListOf,
  type UndecidedCount,
  undecidedCountOf,
  undecidedLineOf,
} from "../reviewList.ts";
import { SchemaFailure } from "../SchemaFailure.ts";
import type { GapCheckRecord, ResolveRecord } from "../stepRecords.ts";
import { TicketHalted } from "../TicketHalted.ts";
import { UnhandledStop } from "../UnhandledStop.ts";
import { type GapCheckTicket, type SpecEndStep } from "../Workflow.ts";
import { HaltRaiser } from "./HaltRaiser.ts";
import {
  gapCheckLabel,
  type RanStep,
  type Run,
  type RunResult,
  runTickets,
  type SpecStepRequest,
  type TrackedIssue,
  type Wait,
} from "./runState.ts";
import { runHalts } from "./runState/runHalts.ts";
import { runText } from "./runState/runText.ts";
import { ticketSteps } from "./runState/ticketSteps.ts";
import { SpecRunBase } from "./SpecRunBase.ts";
import { StepLauncher } from "./StepLauncher.ts";

export class ReviewListPoster extends SpecRunBase {
  private get haltRaiser(): HaltRaiser {
    return new HaltRaiser(this.config);
  }

  private get stepLauncher(): StepLauncher {
    return new StepLauncher(this.config);
  }

  // Posts the notes before the comment, so a ticket marked posted has posted both.
  async _postReviewList(run: Run, ticket: TrackedIssue): Promise<void> {
    const state = runTickets.stateOf(run, ticket.issue);
    if (state.isReviewListPosted) return;
    const records = state.resolveRecords ?? [];
    await this._postCoveredLaterNotes(ticket.issue, records);
    const body = ticketReviewListOf({
      ticket: ticket.issue,
      title: ticket.title,
      records,
      mergeMasterRecord: state.mergeMasterRecord,
      unrecordedMerge: state.unrecordedMerge,
      unverified: ticketSteps.keptUnverifiedOf(state),
    });
    if (body !== undefined && !(await this._hasReviewList(run, ticket.issue))) {
      await this._postReviewListComment(run, ticket.issue, body);
    }
    state.isReviewListPosted = true;
    this._saveState(run);
  }

  // A run's landing never edits a posted list, but a session's re-review does, so a Propose it adds reaches the spec.
  async _postSessionReviewList(run: Run, ticket: TrackedIssue): Promise<void> {
    const list = {
      ticket: ticket.issue,
      title: ticket.title,
      records: runTickets.stateOf(run, ticket.issue).resolveRecords ?? [],
    };
    const mark = reviewListMarkOf(ticket.issue);
    const listed = (
      await this.config.github.authoredCommentsOf(run.spec.issue)
    ).filter(
      (comment) => isRunnersComment(comment) && comment.body.includes(mark),
    );
    // Only the developer's is edited, as `runner decide` edits only theirs; anyone else's still counts as posted.
    const posted = listed.find((comment) =>
      isDevelopersReviewList(comment, this.config.developer),
    );
    if (posted !== undefined) {
      const body = reReviewedCommentOf({ ...list, posted: posted.body });
      if (body !== undefined) {
        await this.config.github.editComment(posted.id, body);
      }
      return;
    }
    const body = ticketReviewListOf(list);
    if (body !== undefined && listed.length === 0) {
      await this._postReviewListComment(run, ticket.issue, body);
    }
  }

  // Each checks the later ticket for its mark first, so a rerun never posts it twice.
  async _postCoveredLaterNotes(
    ticket: IssueRef,
    records: ResolveRecord[],
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

  async _runnersSpecCommentsOf(run: Run): Promise<string[]> {
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

  // Undefined once a spec-end Step halts.
  // A Standalone ticket gets none: it has no User Stories or Implementation Decisions to check, and its review checked its acceptance criteria.
  // A RunStop is thrown on to the run loop, which ends every unfinished member on it.
  async _finish(run: Run, waits: Wait[]): Promise<RunResult | undefined> {
    await this._postLandedReviewLists(run);
    const { specEnd } = this._workflowOf(run.spec);
    const steps =
      specEnd.isDue(waits) && !run.isStandalone ? specEnd.steps : [];
    let count: UndecidedCount | undefined;
    for (const step of steps) {
      let ended: SpecEndOutcome;
      try {
        ended = await this._runSpecEndStep(run, step);
      } catch (error) {
        if (error instanceof TicketHalted) return undefined;
        if (!(error instanceof UnhandledStop)) throw error;
        return this._end(
          run,
          "stopped",
          `${specEndStepNames[step]} ${runText.stoppedOn(error)}. Rerun to retry it.`,
        );
      }
      if (ended.stop !== undefined) {
        return this._end(run, "stopped", ended.stop);
      }
      if (ended.count !== undefined) count = ended.count;
    }
    if (count === undefined) count = await this._undecidedCountOf(run);
    const isLeftOpen = run.isStandalone && count.items > 0;
    const message = this._withRerunLine(
      run,
      endMessageOf(run.landed, waits, isLeftOpen),
      waits,
    );
    return this._end(
      run,
      "finished",
      this._withUndecidedLine(run, message, count),
    );
  }

  private async _runSpecEndStep(
    run: Run,
    step: SpecEndStep,
  ): Promise<SpecEndOutcome> {
    const runners: Record<SpecEndStep, () => Promise<SpecEndOutcome>> = {
      "gap-check": async () => {
        await this._gapCheck(run);
        return {};
      },
      judge: () => this._judge(run),
    };
    return runners[step]();
  }

  // Counts every runner's review list, as the end message's count does, so the stop and the count agree.
  private async _judge(run: Run): Promise<SpecEndOutcome> {
    const count = await this._undecidedCountOf(run);
    if (count.items === 0) return { count };
    const judgeThenRerun = runText.judgeThenRerunOf(this._rerunCommandOf(run));
    return { stop: runText.runEndedOf(run.landed, judgeThenRerun) };
  }

  private async _undecidedCountOf(run: Run): Promise<UndecidedCount> {
    return undecidedCountOf(await this._runnersSpecCommentsOf(run));
  }

  // Catches a ticket that landed in a run killed before its review list was posted.
  private async _postLandedReviewLists(run: Run): Promise<void> {
    for (const ticket of run.tickets) {
      const state = run.state.tickets[issueRef.labelOf(ticket)];
      if (state?.step !== "landed" || state.isReviewListPosted) continue;
      await this._postReviewList(run, await this.config.github.issueOf(ticket));
    }
  }

  // A `skip` answer delivers the gap check's Halt and posts no list, so a delivered one counts as done too; a Standalone ticket needs none.
  async _isGapChecked(run: Run): Promise<boolean> {
    if (run.isStandalone) return true;
    const isSkipped = runHalts
      .of(run)
      .some((halt) => runHalts.isGapCheck(halt) && halt.isDelivered);
    return isSkipped || (await this._hasReviewList(run, gapCheckSubject));
  }

  // Runs in the primary root on master, where every landed ticket's work is; it reads and writes nothing else.
  private async _gapCheck(run: Run): Promise<void> {
    if (await this._hasReviewList(run, gapCheckSubject)) return;
    const answer = gapCheckAnswerOf(run);
    if (answer?.kind === "skip") {
      deliverGapCheckHalts(run);
      this._saveState(run);
      this._log(run, "The gap check was skipped on its Failure Halt's answer.");
      return;
    }
    const { knobs } = this.config;
    const tickets: GapCheckTicket[] = await Promise.all(
      run.tickets.map((ticket) => this.config.github.issueOf(ticket)),
    );
    const rules = this._agentStepOf(run.spec, "gapCheck");
    let prompt = rules.promptOf({
      spec: run.spec.issue,
      title: run.spec.title,
      tickets,
    });
    if (answer?.kind === "guidance") {
      prompt = `${prompt}\n\n${guidanceSectionOf(answer.text)}`;
    }
    const request: SpecStepRequest = {
      prompt,
      pair: answer?.kind === "rerun" ? answer.pair : knobs.gapCheckPair,
      cwd: this.config.primaryRoot,
      gateRoot: this.config.primaryRoot,
      maxTurns: knobs.maxTurns.gapCheck,
      silenceTimeoutMs: knobs.silenceTimeoutMs,
      wallClockMs: knobs.wallClockMs.gapCheck,
      targets: [],
      jsonSchema: rules.outputSchema,
    };
    let ran = await this._runGapCheck(run, request);
    for (
      let retries = 0;
      ticketSteps.isTurnCapped(ran.result) && retries < knobs.retriesPerFailure;
      retries += 1
    ) {
      ran = await this._runGapCheck(run, request);
    }
    const { result, logPath } = ran;
    if (ticketSteps.isTurnCapped(result)) {
      const detail = ticketSteps.turnCapDetailOf(
        gapCheckLabel,
        knobs.maxTurns.gapCheck,
      );
      await this._gapCheckHalt(run, { detail, logPath });
    }
    let record: GapCheckRecord;
    try {
      record = rules.recordOf(
        ticketSteps.recordOf(gapCheckLabel, result, logPath),
      );
    } catch (error) {
      if (!(error instanceof SchemaFailure)) throw error;
      return this._gapCheckHalt(run, {
        detail: error.message,
        logPath: error.logPath,
      });
    }
    await this._postReviewListComment(
      run,
      gapCheckSubject,
      gapCheckListOf(run.spec.title, record),
    );
    deliverGapCheckHalts(run);
    this._saveState(run);
  }

  private async _runGapCheck(
    run: Run,
    request: SpecStepRequest,
  ): Promise<RanStep> {
    return this.stepLauncher._runSpecStep(run, gapCheckLabel, request);
  }

  // Raised on the spec issue and never counted toward the stuck detector, since the gap check belongs to no ticket.
  private async _gapCheckHalt(
    run: Run,
    failure: Omit<StepFailure, "step">,
  ): Promise<never> {
    deliverGapCheckHalts(run);
    runHalts.raise(run, {
      ticket: run.spec.issue,
      drafts: [failureHaltOf({ ...failure, step: "gap-check" }, [])],
    });
    await this.haltRaiser._postUnpostedHalts(run);
    throw new TicketHalted(issueRef.labelOf(run.spec.issue));
  }

  // Counts every review-list comment on the spec, earlier runs' included, since the developer decides them in one place.
  // Only a Batch member's end says it, so the developer can judge one while the rest run; a lone run's end gives the judge line instead.
  private _withUndecidedLine(
    run: Run,
    message: string,
    count: UndecidedCount,
  ): string {
    if (!run.isBatchMember) return message;
    if (this.config.knobs.reviewListCadence !== "end-of-run") return message;
    if (count.items === 0) return message;
    return `${message} ${undecidedLineOf(count)}.`;
  }
}

// What a spec-end Step hands back: the message the run stops on, and the undecided count a judge Step read, so the end needn't read it again.
interface SpecEndOutcome {
  stop?: string;
  count?: UndecidedCount;
}

// Each spec-end Step's name as a run's end message opens with it.
const specEndStepNames: Record<SpecEndStep, string> = {
  "gap-check": "The gap check",
  judge: "The judge Step",
};

// The latest answer the gap check hasn't acted on; a `stop spec` read on a later run is a skip.
function gapCheckAnswerOf(run: Run): FailureAnswer | undefined {
  const latest = runHalts
    .of(run)
    .filter((halt) => runHalts.isGapCheck(halt) && !halt.isDelivered)
    .at(-1);
  if (!isAnswered(latest)) return undefined;
  if (haltReplies.isStopSpecAnswer(latest)) return { kind: "skip" };
  return haltReplies.failureAnswerOf(latest);
}

function deliverGapCheckHalts(run: Run): void {
  runHalts
    .of(run)
    .filter(runHalts.isGapCheck)
    .forEach((halt) => {
      halt.isDelivered = true;
    });
}

function endMessageOf(
  landed: IssueRef[],
  waits: Wait[],
  isLeftOpen: boolean,
): string {
  let waitingPart = `${runText.waitsOf(waits)}.`;
  if (waits.length === 0) {
    waitingPart = isLeftOpen
      ? "The ticket is left open until /judge-findings decides its review list."
      : "Every ticket is closed.";
  }
  return runText.runEndedOf(landed, waitingPart);
}
