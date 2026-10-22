// The review lists and the gap check. At landing a ticket with Proposals gets one review-list comment on the spec and each
// covered-later Dismiss a note on its later ticket, each checked for its marker first; once every ticket is closed, _finish
// posts any review list a killed run missed and runs the gap check, whose gaps become the last review list.
// RunLoop.ts calls _finish; SessionReviewer.ts calls _runnersSpecCommentsOf and _postReviewList; TicketLander.ts calls it at landing.
// It builds its own StepLauncher and HaltRaiser; formats are ../reviewList.ts, the gap check's prompt ../gapCheck.ts.

import type { StepRequest } from "../AgentStep.ts";
import { type TriageRecord } from "../findingTriage.ts";
import {
  gapCheckOutputSchema,
  gapCheckPrompt,
  type GapCheckRecord,
  gapCheckRecordOf,
  type GapCheckTicket,
} from "../gapCheck.ts";
import {
  type FailureAnswer,
  failureAnswerOf,
  failureHaltOf,
  guidanceSectionOf,
  isRunnersComment,
  isStopSpecAnswer,
  runnerMark,
  type StepFailure,
} from "../halts.ts";
import { issueLabelOf, type IssueRef } from "../IssueWorkspaces.ts";
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
} from "../reviewList.ts";
import { RunStop } from "../RunStop.ts";
import { SchemaFailure } from "../SchemaFailure.ts";
import { TicketHalted } from "../TicketHalted.ts";
import { UnhandledStop } from "../UnhandledStop.ts";
import { HaltRaiser } from "./HaltRaiser.ts";
import {
  gapCheckLabel,
  haltsOf,
  isGapCheckHalt,
  isTurnCapped,
  landedTextOf,
  raiseHalts,
  type RanStep,
  recordOf,
  type Run,
  type RunResult,
  stoppedOnTextOf,
  ticketStateOf,
  type TrackedIssue,
  turnCapDetailOf,
  type Wait,
  waitsTextOf,
} from "./runState.ts";
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

  // The gap check waits for every ticket to close, since an open one may still land what it would report; undefined once it halts.
  async _finish(run: Run, waits: Wait[]): Promise<RunResult | undefined> {
    await this._postLandedReviewLists(run);
    if (waits.length === 0) {
      try {
        await this._gapCheck(run);
      } catch (error) {
        if (error instanceof TicketHalted) return undefined;
        if (error instanceof RunStop) {
          return this._end(run, "stopped", error.message);
        }
        if (!(error instanceof UnhandledStop)) throw error;
        return this._end(
          run,
          "stopped",
          `The gap check ${stoppedOnTextOf(error)}. Rerun to retry it.`,
        );
      }
    }
    const message = this._withRerunLine(
      run,
      endMessageOf(run.landed, waits),
      waits,
    );
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
    let prompt = gapCheckPrompt({
      spec: run.spec.issue,
      title: run.spec.title,
      tickets,
    });
    if (answer?.kind === "guidance") {
      prompt = `${prompt}\n\n${guidanceSectionOf(answer.text)}`;
    }
    const request: StepRequest = {
      prompt,
      pair: answer?.kind === "rerun" ? answer.pair : knobs.gapCheckPair,
      account: knobs.account,
      cwd: this.config.primaryRoot,
      maxTurns: knobs.maxTurns.gapCheck,
      silenceTimeoutMs: knobs.silenceTimeoutMs,
      wallClockMs: knobs.wallClockMs.gapCheck,
      allowedTools: knobs.allowedTools.gapCheck,
      allowedWriteGlobs: [],
      targets: [],
      jsonSchema: gapCheckOutputSchema,
    };
    let ran = await this._runGapCheck(run, request);
    for (
      let retries = 0;
      isTurnCapped(ran.result) && retries < knobs.retriesPerFailure;
      retries += 1
    ) {
      ran = await this._runGapCheck(run, request);
    }
    const { result, logPath } = ran;
    if (isTurnCapped(result)) {
      const detail = turnCapDetailOf(gapCheckLabel, knobs.maxTurns.gapCheck);
      await this._gapCheckHalt(run, { detail, logPath });
    }
    let record: GapCheckRecord;
    try {
      record = gapCheckRecordOf(recordOf(gapCheckLabel, result, logPath));
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

  private async _runGapCheck(run: Run, request: StepRequest): Promise<RanStep> {
    return this.stepLauncher._runSpecStep(run, gapCheckLabel, request);
  }

  // Raised on the spec issue and never counted toward the stuck detector, since the gap check belongs to no ticket.
  private async _gapCheckHalt(
    run: Run,
    failure: Omit<StepFailure, "step">,
  ): Promise<never> {
    deliverGapCheckHalts(run);
    raiseHalts(run, {
      ticket: run.spec.issue,
      drafts: [failureHaltOf({ ...failure, step: "gap-check" }, [])],
    });
    await this.haltRaiser._postUnpostedHalts(run);
    throw new TicketHalted(issueLabelOf(run.spec.issue));
  }

  // Counts every review-list comment on the spec, earlier runs' included, since the developer decides them in one place.
  private async _withUndecidedLine(run: Run, message: string): Promise<string> {
    if (this.config.knobs.reviewListCadence !== "end-of-run") return message;
    const count = undecidedCountOf(await this._runnersSpecCommentsOf(run));
    if (count.items === 0) return message;
    return `${message} ${undecidedLineOf(count)}.`;
  }
}

// The latest answer the gap check hasn't acted on; a `stop spec` read on a later run is a skip.
function gapCheckAnswerOf(run: Run): FailureAnswer | undefined {
  const latest = haltsOf(run)
    .filter((halt) => isGapCheckHalt(halt) && !halt.isDelivered)
    .at(-1);
  if (latest?.answer === undefined) return undefined;
  if (isStopSpecAnswer(latest.answer)) return { kind: "skip" };
  return failureAnswerOf(latest, latest.answer);
}

function deliverGapCheckHalts(run: Run): void {
  haltsOf(run)
    .filter(isGapCheckHalt)
    .forEach((halt) => {
      halt.isDelivered = true;
    });
}

function endMessageOf(landed: IssueRef[], waits: Wait[]): string {
  const waitingPart =
    waits.length === 0 ? "Every ticket is closed." : `${waitsTextOf(waits)}.`;
  return `Run ended: ${landedTextOf(landed)}. ${waitingPart}`;
}
