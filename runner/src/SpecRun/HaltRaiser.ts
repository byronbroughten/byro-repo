// A spec run's Halts: raising a ticket's blocker and Failure Halts, posting them to the spec once its other work is committed,
// and halting the ticket; a crash past its retries is a Failure Halt, and a streak of them Stops the run as stuck.
// It also works out a ticket's downstream, the run's tickets it blocks, which a Halt's scope names.
// The lowest collaborator: it calls only the Base, and every collaborator that halts a ticket builds one.
// Halt formats are ../halts.ts and reply matching ../halts/haltReplies.ts; the coordinator callers build is ../SpecRun.ts.

import {
  blockerHaltOf,
  failureHaltOf,
  failureOptions,
  haltCommentOf,
  haltNoticeOf,
  type HaltPost,
  handoffCapDetailOf,
  sessionHaltCommentOf,
  shortRefOf,
  type StepFailure,
} from "../halts.ts";
import { type IssueRef, issueRef } from "../IssueWorkspaces.ts";
import { RunStop } from "../RunStop.ts";
import type { Blocker, ProposedSlice } from "../stepRecords.ts";
import { TicketHalted } from "../TicketHalted.ts";
import {
  type Crash,
  type LandingTicket,
  type Run,
  runTickets,
  type TicketRun,
} from "./runState.ts";
import { runHalts } from "./runState/runHalts.ts";
import { ticketSteps } from "./runState/ticketSteps.ts";
import { SpecRunBase } from "./SpecRunBase.ts";

export interface RedCheckBudget {
  limit: number;
  // Takes the resumes already spent.
  failureOf(resumes: number): StepFailure;
}

export class HaltRaiser extends SpecRunBase {
  // Snapshots a step that edits; a crash past the retries is a Failure Halt.
  async _takeCrash(ticketRun: TicketRun, crash: Crash): Promise<void> {
    const { run, ticket, state } = ticketRun;
    const { step } = state;
    const { detail } = crash;
    if (ticketSteps.isSnapshotted(step)) await this._snapshot(ticketRun, step);
    state.crashes ??= {};
    const taken = state.crashes[step] ?? 0;
    const { retriesPerFailure } = this.config.knobs;
    if (taken >= retriesPerFailure) {
      await this._failureHalt(ticketRun, { ...crash, step });
    }
    state.crashes[step] = taken + 1;
    this._saveState(run);
    this._log(
      run,
      `${issueRef.labelOf(ticket.issue)}: ${detail} Retrying, ${taken + 1} of ${retriesPerFailure}.`,
    );
  }

  // A red check sends its step back up to the limit, counted across the ticket's checks, then raises the Failure Halt.
  async _spendRedCheckResume(
    ticketRun: TicketRun,
    { limit, failureOf }: RedCheckBudget,
  ): Promise<void> {
    const { run, state } = ticketRun;
    const resumes = state.redCheckResumes ?? 0;
    if (resumes >= limit) {
      await this._failureHalt(ticketRun, failureOf(resumes));
    }
    state.redCheckResumes = resumes + 1;
    this._saveState(run);
  }

  async _failureHalt(
    landingTicket: LandingTicket,
    failure: StepFailure,
  ): Promise<never> {
    const { run, ticket } = landingTicket;
    const downstream = await this._downstreamOf(run, ticket.issue);
    runHalts.raise(run, {
      ticket: ticket.issue,
      drafts: [failureHaltOf(failure, downstream)],
    });
    await this._stopIfStuck(landingTicket);
    return this._halt(landingTicket);
  }

  // Posts the last Halt before the Stop, so the developer can answer it.
  private async _stopIfStuck(landingTicket: LandingTicket): Promise<void> {
    const { run, ticket } = landingTicket;
    const label = issueRef.labelOf(ticket.issue);
    if (!run.failureStreak.includes(label)) run.failureStreak.push(label);
    if (run.failureStreak.length < this.config.knobs.stuckFailureHalts) return;
    await this._postHalts(landingTicket);
    throw new RunStop(
      `Stopped as stuck: ${run.failureStreak.join(", ")} each ended on a Failure Halt in a row; answer them, then rerun.`,
    );
  }

  // Checked at each fresh step's launch after a handoff, so a crash or an answer other than `continue +1 handoff` never skips it.
  async _haltPastHandoffCap(
    ticketRun: TicketRun,
    slices: ProposedSlice[],
  ): Promise<void> {
    const { run, ticket, state } = ticketRun;
    const { knobs } = this.config;
    if (!ticketSteps.isPastHandoffCap(state, knobs)) return;
    await this._failureHalt(ticketRun, {
      step: state.step,
      detail: handoffCapDetailOf({
        ticket: ticket.issue,
        count: state.handoffCount ?? 0,
        cap: ticketSteps.handoffCapOf(state, knobs),
        slices,
      }),
      logPath: this._progressPathOf(run),
      options: [failureOptions.moreHandoffs],
    });
  }

  async _raiseBlockerHalts(
    ticketRun: TicketRun,
    blockers: Blocker[],
    deniedTools: string[],
  ): Promise<void> {
    if (blockers.length === 0) return;
    const downstream = await this._downstreamOf(
      ticketRun.run,
      ticketRun.ticket.issue,
    );
    runHalts.raise(ticketRun.run, {
      ticket: ticketRun.ticket.issue,
      drafts: blockers.map((blocker) =>
        blockerHaltOf(blocker, { downstream, deniedTools }),
      ),
    });
  }

  // Posts the ticket's new Halts and halts it; with none, the ticket goes on.
  async _haltOnUnpostedHalts(ticketRun: TicketRun): Promise<void> {
    const { run, ticket } = ticketRun;
    const unposted = runHalts
      .ofTicket(run, ticket.issue)
      .filter(({ isPosted }) => !isPosted);
    if (unposted.length === 0) return;
    await this._halt(ticketRun);
  }

  private async _halt(landingTicket: LandingTicket): Promise<never> {
    await this._postHalts(landingTicket);
    throw new TicketHalted(issueRef.labelOf(landingTicket.ticket.issue));
  }

  private async _postHalts(landingTicket: LandingTicket): Promise<void> {
    this._advance(landingTicket, "halted");
    await this._postUnpostedHalts(landingTicket.run);
  }

  // Also picks up the Halts of a ticket that halted in a run killed before they were all posted.
  async _postUnpostedHalts(run: Run): Promise<void> {
    // The gap check's is checked first, so it never creates a ticket state for the spec.
    const unposted = runHalts
      .of(run)
      .filter(
        (halt) =>
          !halt.isPosted &&
          (runHalts.isGapCheck(halt) ||
            runTickets.stateOf(run, halt.ticket).step === "halted"),
      );
    for (const halt of unposted) {
      const batch = unposted.filter(({ ticket }) =>
        issueRef.isSame(ticket, halt.ticket),
      );
      const post: HaltPost = {
        halt,
        index: batch.indexOf(halt) + 1,
        count: batch.length,
        ticketTitle: (await this.config.github.issueOf(halt.ticket)).title,
      };
      const { sessionReview } = run;
      const body =
        sessionReview === undefined
          ? haltCommentOf(post)
          : sessionHaltCommentOf(post);
      const commentUrl = await this._comment(run, body);
      sessionReview?.postedHalts.push(body);
      halt.isPosted = true;
      this._saveState(run);
      await this._announce(run, haltNoticeOf(post), {
        kind: halt.kind === "failure" ? "failure-halt" : "halt",
        ticket: halt.ticket,
        commentUrl,
      });
    }
  }

  // The run's tickets this one blocks, directly or through another, each `<repo>#<n>`.
  async _downstreamOf(run: Run, issue: IssueRef): Promise<string[]> {
    const blockersOf = await this._blockersByTicketOf(run);
    return runHalts.downstreamIn({
      run,
      blockersOf,
      ticket: shortRefOf(issue),
    });
  }

  // Each of the run's tickets, `<repo>#<n>`, to its open blockers.
  async _blockersByTicketOf(run: Run): Promise<Map<string, string[]>> {
    const blockersOf = new Map<string, string[]>();
    for (const ticket of run.tickets) {
      const blockers = await this.config.github.openBlockersOf(ticket);
      blockersOf.set(shortRefOf(ticket), blockers.map(shortRefOf));
    }
    return blockersOf;
  }
}
