// A ticket's landing. It writes the facts file, runs the wrap-up until it lands and posts the ticket's review list.
// A research ticket lands with no code: its comment is posted first, its closing comment is its Workflow's, and its Research Halt is posted last.
// TicketSequencer.ts calls _check after the resolve step and _land at wrap-up.
// _check only delegates: a ticket's checks are TicketLander/TicketChecker.ts.
// A wrap-up failure, the merge of master on a conflict included, is TicketLander/MasterMerger.ts.
// It builds its own TicketChecker, MasterMerger, ReviewListPoster and HaltRaiser.

import { readFileSync } from "node:fs";

import { type WrapUpFacts } from "../FactsFile.ts";
import { haltKindLabelOf, runnerMark } from "../halts.ts";
import { issueRef } from "../IssueWorkspaces.ts";
import { pairLabelOf } from "../modelFit.ts";
import { type RecordedSession, unrecordedFactsOf } from "../transcriptFacts.ts";
import { HaltRaiser } from "./HaltRaiser.ts";
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

  private get haltRaiser(): HaltRaiser {
    return new HaltRaiser(this.config);
  }

  async _check(ticketRun: TicketRun): Promise<void> {
    return this.ticketChecker._check(ticketRun);
  }

  // Needs no workspace: a wrap-up killed after removing it resumes from its own progress file.
  async _land(landingTicket: LandingTicket): Promise<void> {
    const { run, ticket, state } = landingTicket;
    const steps = ticketSteps.recordedSessionsOf(state);
    const hasNoCode = this._landingOf(landingTicket) === "research";
    if (hasNoCode) {
      await this._postResearch(landingTicket);
      this._writeResearchFacts(landingTicket, steps);
      await this.haltRaiser._raiseResearchHalt(landingTicket);
    } else {
      this._writeFacts(landingTicket, steps);
    }
    this._warnOnUnrecordedFacts(landingTicket, steps);
    this._log(run, `${issueRef.labelOf(ticket.issue)}: wrapping up.`);
    for (;;) {
      try {
        await this.wrapUp.run(ticket.issue, { hasNoCode });
        break;
      } catch (error) {
        await this.masterMerger._takeWrapUpFailure(landingTicket, error);
        // A merge-master resume adds an item to the review list, which the rerun's close step reads.
        this.factsFile.setReviewFacts(
          ticket.issue,
          ticketSteps.reviewFactsOf(state, this._workflowOf(run.spec)),
        );
      }
    }
    this._advance(landingTicket, "landed");
    this._log(run, `${issueRef.labelOf(ticket.issue)}: landed.`);
    await this.reviewListPoster._postReviewList(run, ticket);
    if (hasNoCode) await this.haltRaiser._postUnpostedHalts(run);
  }

  // Posted once, before the wrap-up closes the ticket, so a retried wrap-up never posts it again.
  private async _postResearch(landingTicket: LandingTicket): Promise<void> {
    const { run, ticket, state } = landingTicket;
    if (state.isResearchPosted) return;
    const { commentPath } = ticketSteps.readyResearchRecordOf(landingTicket);
    await this.config.github.comment(
      ticket.issue,
      `${runnerMark}\n${readFileSync(commentPath, "utf8")}`,
    );
    state.isResearchPosted = true;
    this._saveState(run);
    this._log(
      run,
      `${issueRef.labelOf(ticket.issue)}: posted the research comment.`,
    );
  }

  private _writeFacts(
    landingTicket: LandingTicket,
    steps: RecordedSession[],
  ): void {
    const { run, ticket, state } = landingTicket;
    const { record } = state;
    if (record === undefined) {
      throw new Error(
        `${issueRef.labelOf(ticket.issue)} reached its wrap-up with no implement record`,
      );
    }
    const facts = factsOf(landingTicket, steps, {
      closingComment: record.closingComment,
      boxesUndone: record.boxesUndone,
      ...ticketSteps.reviewFactsOf(state, this._workflowOf(run.spec)),
      reviewRounds: 1,
    });
    if (record.status === "applied") {
      facts.reviewFixes = "skipped";
      facts.reviewRounds = 0;
      facts.githubWrites = record.githubWrites;
    }
    this.factsFile.write(ticket.issue, facts);
  }

  // A research ticket has no review, so it lands as an applied one does.
  private _writeResearchFacts(
    landingTicket: LandingTicket,
    steps: RecordedSession[],
  ): void {
    const { run, ticket } = landingTicket;
    const closingComment = this._agentStepOf(
      run.spec,
      "research",
    ).closingCommentOf(ticketSteps.readyResearchRecordOf(landingTicket));
    const facts = factsOf(landingTicket, steps, {
      closingComment,
      boxesUndone: [],
      reviewFixes: "skipped",
      reviewRounds: 0,
    });
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

// The facts the step's record and review give; the rest come from the ticket's state.
type StepFacts = Omit<WrapUpFacts, "retries" | "limitResumes" | "pair">;

function factsOf(
  { run, ticket, pair, state }: LandingTicket,
  steps: RecordedSession[],
  stepFacts: StepFacts,
): WrapUpFacts {
  const facts: WrapUpFacts = {
    ...stepFacts,
    retries: retriesOf(state),
    limitResumes: state.limitResumes,
    pair: pairLabelOf(pair),
  };
  const haltKinds = new Set(
    runHalts
      .ofTicket(run, ticket.issue)
      .map(({ kind }) => haltKindLabelOf(kind)),
  );
  if (haltKinds.size > 0) facts.halt = [...haltKinds].join(", ");
  if (steps.length > 0) facts.sessions = { steps };
  return facts;
}

function retriesOf({ crashes = {}, redCheckResumes = 0 }: TicketState): number {
  return Object.values(crashes).reduce(
    (sum, count) => sum + count,
    redCheckResumes,
  );
}
