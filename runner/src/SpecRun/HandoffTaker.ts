// A ticket's handoffs, one implementer's from implement through resolve: each backs up the tree, posts on the ticket and
// leaves the handoff pending for the fresh session that takes the implementer's next step. Past the ticket budget the
// implementer is resumed for one at the next step boundary; killed at the live ceiling during resolve, for one at once.
// A fresh step past the handoff cap, or after a proposed split, halts first; the cap counts every step's handoffs.
// ImplementStepper.ts hands it the implement step's own handoff records; ReviewStepper.ts, TicketLander/TicketChecker.ts
// and TicketLander/MasterMerger.ts call it at their step boundaries. It builds its own HaltRaiser and StepLauncher.

import { saveUncommitted } from "../git.ts";
import { splitHaltOf } from "../halts.ts";
import { issueRef } from "../IssueWorkspaces.ts";
import { SchemaFailure } from "../SchemaFailure.ts";
import {
  budgetHandoffPrompt,
  handoffOnlyPrompt,
} from "../stepPrompts/resumePrompts.ts";
import type { Handoff } from "../stepRecords.ts";
import type { StepAgent } from "../transcriptFacts.ts";
import type { ImplementRules } from "../Workflow.ts";
import { HaltRaiser } from "./HaltRaiser.ts";
import type { LaunchedStep, TicketRun } from "./runState.ts";
import { runHalts } from "./runState/runHalts.ts";
import { ticketSteps } from "./runState/ticketSteps.ts";
import { SpecRunBase } from "./SpecRunBase.ts";
import { StepLauncher } from "./StepLauncher.ts";

// The steps after implement that a handoff can come before; review runs in its own session but is the warmest boundary.
export type BoundaryStep = "review" | "resolve" | "red-checks" | "merge-master";

export interface HandoffResume {
  agent: StepAgent;
  prompt: string;
  sessionId: string;
}

export interface HandoffLaunch {
  launched: LaunchedStep;
  handoff: Handoff;
}

interface HandoffPost {
  handoff: Handoff;
  // Where the implementer handed off, worded for the posted comment, as "before the review step".
  point: string;
}

export class HandoffTaker extends SpecRunBase {
  private get haltRaiser(): HaltRaiser {
    return new HaltRaiser(this.config);
  }

  private get stepLauncher(): StepLauncher {
    return new StepLauncher(this.config);
  }

  // Skipped with no implementer session, as a session's review has, or with a handoff already pending.
  async _handOffPastBudget(
    ticketRun: TicketRun,
    step: BoundaryStep,
  ): Promise<void> {
    const { run, ticket, state } = ticketRun;
    const sessionId = ticketSteps.implementerSessionOf(state);
    if (sessionId === undefined || state.latestHandoff !== undefined) return;
    if (!ticketSteps.isPastBudget(state, this.config.knobs)) return;
    const point = `before the ${step} step`;
    this._log(
      run,
      `${issueRef.labelOf(ticket.issue)}: the implementer is past the ticket budget; resuming it for a handoff ${point}.`,
    );
    const handoff = await this._resumedHandoffOf(
      ticketRun,
      { agent: "implement", prompt: budgetHandoffPrompt, sessionId },
      `The implementer was past the ticket budget ${point}`,
    );
    await this._handOff(ticketRun, { handoff, point });
  }

  // The resolve's own work stays in the tree for the fresh session that carries the resolve on.
  async _handOffAtCeiling(
    ticketRun: TicketRun,
    crossedSession: string | undefined,
  ): Promise<void> {
    const { ticket } = ticketRun;
    const sessionId = ticketSteps.sessionIdOf(
      ticket.issue,
      "resolve step past the live ceiling",
      crossedSession,
    );
    const handoff = await this._resumedHandoffOf(
      ticketRun,
      { agent: "resolve", prompt: handoffOnlyPrompt, sessionId },
      `The resolve step crossed ${ticketSteps.liveCeilingPhraseOf(this.config.knobs)}`,
    );
    await this._handOff(ticketRun, { handoff, point: "in the resolve step" });
  }

  // A record that isn't a handoff fails the step; the Workflow's other record checks are the implement step's own.
  async _resumedHandoffLaunchOf(
    ticketRun: TicketRun,
    { agent, prompt, sessionId }: HandoffResume,
  ): Promise<HandoffLaunch> {
    const rules = this._implementRulesOf(ticketRun);
    const ran = await this.stepLauncher._runStep(ticketRun, agent, {
      prompt,
      jsonSchema: rules.outputSchema,
      resumeSessionId: sessionId,
    });
    const launched = ticketSteps.launchedOf(agent, ran);
    const record = rules.recordOf(launched.record);
    if (record.status !== "handoff") {
      throw ticketSteps.schemaFailureOf(ran.logPath, {
        problems: [`the record is ${record.status}, not a handoff`],
        output: launched.record,
      });
    }
    return { launched, handoff: record.handoff };
  }

  // Snapshots the work, then names why the handoff was asked for, so the Failure Halt offers `retry record` when the step had committed.
  async _handoffFailureOf(
    ticketRun: TicketRun,
    error: unknown,
    why: string,
  ): Promise<unknown> {
    if (!(error instanceof SchemaFailure)) return error;
    await this._snapshot(ticketRun, ticketRun.state.step);
    return new SchemaFailure(
      `${why}, and its handoff record failed: ${error.message}`,
      error.logPath,
    );
  }

  // The work stays in the tree for the fresh step; the backup branch is in case that step loses it.
  async _handOff(
    ticketRun: TicketRun,
    { handoff, point }: HandoffPost,
  ): Promise<void> {
    const { ticket, state } = ticketRun;
    const sessionId = ticketSteps.sessionIdOf(
      ticket.issue,
      "handoff",
      state.implementerSession,
    );
    const count = (state.handoffCount ?? 0) + 1;
    await this._backUp(ticketRun, `handoff-${count}`, saveUncommitted);
    const comment = this._implementRulesOf(ticketRun).handoffCommentOf({
      handoff,
      sessionId,
      point,
    });
    state.latestHandoff = handoff;
    await this._postHandoff(ticketRun, comment);
  }

  // The split Halt is checked with the cap, so a split past the cap rides on the cap's Failure Halt.
  async _haltBeforeFreshStep(
    ticketRun: TicketRun,
    { proposedSplit }: Handoff,
  ): Promise<void> {
    const { run, ticket, state } = ticketRun;
    const count = state.handoffCount ?? 0;
    const isSplitUnhalted =
      proposedSplit !== undefined && state.splitHaltedHandoff !== count;
    if (
      isSplitUnhalted &&
      ticketSteps.isPastHandoffCap(state, this.config.knobs)
    ) {
      state.splitHaltedHandoff = count;
    }
    await this.haltRaiser._haltPastHandoffCap(
      ticketRun,
      isSplitUnhalted ? proposedSplit : [],
    );
    if (!isSplitUnhalted) return;
    const downstream = await this.haltRaiser._downstreamOf(run, ticket.issue);
    runHalts.raise(run, {
      ticket: ticket.issue,
      drafts: [splitHaltOf(proposedSplit, downstream)],
    });
    state.splitHaltedHandoff = count;
    await this.haltRaiser._haltOnUnpostedHalts(ticketRun);
  }

  private async _resumedHandoffOf(
    ticketRun: TicketRun,
    resume: HandoffResume,
    why: string,
  ): Promise<Handoff> {
    try {
      return (await this._resumedHandoffLaunchOf(ticketRun, resume)).handoff;
    } catch (error) {
      throw await this._handoffFailureOf(ticketRun, error, why);
    }
  }

  private _implementRulesOf({ run }: TicketRun): ImplementRules {
    return this._agentStepOf(run.spec, "implement");
  }
}
