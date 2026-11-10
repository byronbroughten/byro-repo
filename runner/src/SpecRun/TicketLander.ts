// A ticket's landing. It writes the facts file, runs the wrap-up until it lands and posts the ticket's review list.
// TicketSequencer.ts calls _check after the resolve step and _land at wrap-up.
// _check only delegates: a ticket's checks are TicketLander/TicketChecker.ts.
// A wrap-up failure, the merge of master on a conflict included, is TicketLander/MasterMerger.ts.
// It builds its own TicketChecker, MasterMerger and ReviewListPoster.

import { type WrapUpFacts } from "../FactsFile.ts";
import { haltKindLabelOf } from "../halts.ts";
import { issueRef } from "../IssueWorkspaces.ts";
import { pairLabelOf } from "../modelFit.ts";
import { type RecordedSession, unrecordedFactsOf } from "../transcriptFacts.ts";
import { ReviewListPoster } from "./ReviewListPoster.ts";
import {
  type LandingTicket,
  type TicketRun,
  type TicketState,
} from "./runState.ts";
import { runHalts } from "./runState/runHalts.ts";
import { ticketSteps } from "./runState/ticketSteps.ts";
import { SpecRunBase } from "./SpecRunBase.ts";
import { MasterMerger } from "./TicketLander/MasterMerger.ts";
import { TicketChecker } from "./TicketLander/TicketChecker.ts";

export class TicketLander extends SpecRunBase {
  private get ticketChecker(): TicketChecker {
    return new TicketChecker(this.config);
  }

  private get masterMerger(): MasterMerger {
    return new MasterMerger(this.config);
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
    this._log(run, `${issueRef.labelOf(ticket.issue)}: wrapping up.`);
    for (;;) {
      try {
        await this.wrapUp.run(ticket.issue);
        break;
      } catch (error) {
        await this.masterMerger._takeWrapUpFailure(landingTicket, error);
        // A merge-master resume adds an item to the review list, which the rerun's close step reads.
        this.factsFile.setReviewFacts(
          ticket.issue,
          ticketSteps.reviewFactsOf(state),
        );
      }
    }
    this._advance(landingTicket, "landed");
    this._log(run, `${issueRef.labelOf(ticket.issue)}: landed.`);
    await this.reviewListPoster._postReviewList(run, ticket);
  }

  private _writeFacts(
    { run, ticket, pair, state }: LandingTicket,
    steps: RecordedSession[],
  ): void {
    const { record } = state;
    if (record === undefined) {
      throw new Error(
        `${issueRef.labelOf(ticket.issue)} reached its wrap-up with no implement record`,
      );
    }
    const facts: WrapUpFacts = {
      closingComment: record.closingComment,
      boxesUndone: record.boxesUndone,
      ...ticketSteps.reviewFactsOf(state),
      reviewRounds: 1,
      retries: retriesOf(state),
      limitResumes: state.limitResumes ?? 0,
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
    const prefix = `${issueRef.labelOf(ticket.issue)}: warning:`;
    const dropped = state.sessions.length - steps.length;
    if (dropped > 0) {
      this._log(
        run,
        `${prefix} ${dropped} step session(s) left out of the facts file, saved with no account or config folder.`,
      );
    }
    if (steps.length === 0) return;
    unrecordedFactsOf({ steps }, this.config.knobs.silenceTimeoutMs).forEach(
      ({ label, reason }) => {
        this._log(run, `${prefix} ${label} written unrecorded: ${reason}.`);
      },
    );
  }
}

function retriesOf({ crashes = {}, redCheckResumes = 0 }: TicketState): number {
  return Object.values(crashes).reduce(
    (sum, count) => sum + count,
    redCheckResumes,
  );
}
