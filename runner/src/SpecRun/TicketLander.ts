// A ticket's landing. It writes the facts file, runs the wrap-up until it lands and posts the ticket's review list.
// A research ticket lands with no code: its comment is posted first, its closing comment is its Workflow's, and its Research Halt is posted last.
// TicketSequencer.ts calls _check after the resolve step and _land at wrap-up.
// _check only delegates: a ticket's checks are TicketLander/TicketChecker.ts.
// A wrap-up failure, the merge of master on a conflict included, is TicketLander/MasterMerger.ts.
// The facts file's writing is TicketLander/FactsWriter.ts.
// It builds its own FactsWriter, TicketChecker, MasterMerger, ReviewListPoster and HaltRaiser.

import { readFileSync } from "node:fs";

import { runnerMark } from "../halts.ts";
import { issueRef } from "../IssueWorkspaces.ts";
import { HaltRaiser } from "./HaltRaiser.ts";
import { ReviewListPoster } from "./ReviewListPoster.ts";
import { type LandingTicket, type TicketRun } from "./runState.ts";
import { ticketSteps } from "./runState/ticketSteps.ts";
import { SpecRunBase } from "./SpecRunBase.ts";
import { FactsWriter } from "./TicketLander/FactsWriter.ts";
import { MasterMerger } from "./TicketLander/MasterMerger.ts";
import { TicketChecker } from "./TicketLander/TicketChecker.ts";

export class TicketLander extends SpecRunBase {
  private get factsWriter(): FactsWriter {
    return new FactsWriter(this.config);
  }

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
      this.factsWriter._writeResearchFacts(landingTicket, steps);
      await this.haltRaiser._raiseResearchHalt(landingTicket);
    } else {
      this.factsWriter._writeFacts(landingTicket, steps);
    }
    this.factsWriter._warnOnUnrecordedFacts(landingTicket, steps);
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
}
