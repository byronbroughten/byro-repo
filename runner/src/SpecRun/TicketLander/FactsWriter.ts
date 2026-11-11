// A ticket's facts file, written before its wrap-up from its state and Workflow, and the warning for session facts left unrecorded.
// ../TicketLander.ts delegates here from _land: a code ticket's facts, or a research ticket's, which has no review.

import { type WrapUpFacts } from "../../FactsFile.ts";
import { haltKindLabelOf } from "../../halts.ts";
import { issueRef } from "../../IssueWorkspaces.ts";
import { pairLabelOf } from "../../modelFit.ts";
import {
  type RecordedSession,
  unrecordedFactsOf,
} from "../../transcriptFacts.ts";
import { type LandingTicket, type TicketState } from "../runState.ts";
import { runHalts } from "../runState/runHalts.ts";
import { ticketSteps } from "../runState/ticketSteps.ts";
import { SpecRunBase } from "../SpecRunBase.ts";

export class FactsWriter extends SpecRunBase {
  _writeFacts(landingTicket: LandingTicket, steps: RecordedSession[]): void {
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
  _writeResearchFacts(
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
  _warnOnUnrecordedFacts(
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
  // A Research Halt adds nothing to its ticket's cost, and a re-landing would otherwise count the one its first landing raised.
  const haltKinds = new Set(
    runHalts
      .ofTicket(run, ticket.issue)
      .filter(({ kind }) => kind !== "research")
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
