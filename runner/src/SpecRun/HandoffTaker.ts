// A ticket's handoffs, one implementer's from implement through resolve: each backs up the tree, posts on the ticket and
// leaves the handoff pending for the fresh session that takes the implementer's next step. Past the ticket budget the
// implementer is resumed for one at the next step boundary; killed at the live ceiling during implement, review or resolve,
// for one at once. A fresh step past the handoff cap, or after a proposed split, halts first; the cap counts every step's handoffs.
// ImplementStepper.ts hands it the implement step's own handoff records; ReviewStepper.ts, TicketLander/TicketChecker.ts
// and TicketLander/MasterMerger.ts call it at their step boundaries. It builds its own HaltRaiser and StepLauncher.

import { saveUncommitted } from "../git.ts";
import { splitHaltOf } from "../halts.ts";
import { issueRef } from "../IssueWorkspaces.ts";
import { SchemaFailure } from "../SchemaFailure.ts";
import { handoffText } from "../stepPrompts/handoffText.ts";
import {
  budgetHandoffPrompt,
  handoffOnlyPrompt,
} from "../stepPrompts/resumePrompts.ts";
import type { Handoff, ImplementRecord } from "../stepRecords.ts";
import type { StepAgent } from "../transcriptFacts.ts";
import type {
  HandoffComment,
  HandoffPoint,
  HandoffStep,
  ImplementRules,
} from "../Workflow.ts";
import { HaltRaiser } from "./HaltRaiser.ts";
import type { LaunchedStep, TicketRun } from "./runState.ts";
import { runHalts } from "./runState/runHalts.ts";
import { ticketSteps } from "./runState/ticketSteps.ts";
import { SpecRunBase } from "./SpecRunBase.ts";
import { StepLauncher } from "./StepLauncher.ts";

// The steps after implement that a handoff can come before, each resuming the implementer's session.
export type BoundaryStep = Exclude<HandoffStep, "implement">;

export interface HandoffLaunch {
  launched: LaunchedStep;
  handoff: Handoff;
}

// A step after implement that the live ceiling can kill, its handoff posted here.
interface StepCrossing {
  agent: "review" | "resolve";
  crossedSession: string | undefined;
}

// The implement step takes its own record from the launch; a later step posts the handoff.
interface CeilingCrossing<CR extends ImplementRecord | void> extends Omit<
  StepCrossing,
  "agent"
> {
  agent: "implement" | StepCrossing["agent"];
  take(launch: HandoffLaunch): Promise<CR>;
}

interface HandoffResume {
  agent: StepAgent;
  prompt: string;
  sessionId: string;
}

interface HandoffAsk<CR extends ImplementRecord | void> {
  resume: HandoffResume;
  // Leads the Failure Halt's message, naming why the handoff was asked for.
  why: string;
  take(launch: HandoffLaunch): Promise<CR>;
}

interface HandoffFailure {
  error: unknown;
  why: string;
}

type HandoffPost = Omit<HandoffComment, "sessionId">;

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
    // An unmeasured peak asks for no handoff: the live ceiling still kills a session that turns out too big.
    if (ticketSteps.budgetOf(state, this.config.knobs) !== "past") return;
    const point: HandoffPoint = { relation: "before", step };
    const pointText = handoffText.pointOf(point);
    this._log(
      run,
      `${issueRef.labelOf(ticket.issue)}: the implementer is past the ticket budget; resuming it for a handoff ${pointText}.`,
    );
    await this._resumedForHandoff(ticketRun, {
      resume: { agent: "implement", prompt: budgetHandoffPrompt, sessionId },
      why: `The implementer was past the ticket budget ${pointText}`,
      take: ({ handoff }) => this._handOff(ticketRun, { handoff, point }),
    });
  }

  // The resolve's own work stays in the tree for the fresh session that carries the resolve on; the review changes nothing, so its successor reviews again.
  async _handOffAtCeiling(
    ticketRun: TicketRun,
    { agent, crossedSession }: StepCrossing,
  ): Promise<void> {
    const { run, ticket } = ticketRun;
    const point: HandoffPoint = { relation: "in", step: agent };
    const pointText = handoffText.pointOf(point);
    this._log(
      run,
      `${issueRef.labelOf(ticket.issue)}: the implementer crossed the live ceiling ${pointText}; resuming it for a handoff.`,
    );
    await this._resumedAtCeiling(ticketRun, {
      agent,
      crossedSession,
      take: ({ handoff }) => this._handOff(ticketRun, { handoff, point }),
    });
  }

  async _resumedAtCeiling<CR extends ImplementRecord | void>(
    ticketRun: TicketRun,
    { agent, crossedSession, take }: CeilingCrossing<CR>,
  ): Promise<CR> {
    const sessionId = ticketSteps.sessionIdOf({
      issue: ticketRun.ticket.issue,
      owner: `${agent} step past the live ceiling`,
      sessionId: crossedSession,
    });
    return this._resumedForHandoff(ticketRun, {
      resume: { agent, prompt: handoffOnlyPrompt, sessionId },
      why: `The ${agent} step crossed ${ticketSteps.liveCeilingPhraseOf(this.config.knobs)}`,
      take,
    });
  }

  // The work stays in the tree for the fresh step; the backup branch is in case that step loses it.
  async _handOff(
    ticketRun: TicketRun,
    { handoff, point }: HandoffPost,
  ): Promise<void> {
    const { ticket, state } = ticketRun;
    const sessionId = ticketSteps.sessionIdOf({
      issue: ticket.issue,
      owner: "handoff",
      sessionId: state.implementerSession,
    });
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

  // The take runs inside the rewrap, so the implement step's own record checks name why the handoff was asked for too.
  private async _resumedForHandoff<CR extends ImplementRecord | void>(
    ticketRun: TicketRun,
    { resume, why, take }: HandoffAsk<CR>,
  ): Promise<CR> {
    try {
      return await take(await this._resumedHandoffLaunchOf(ticketRun, resume));
    } catch (error) {
      throw await this._handoffFailureOf(ticketRun, { error, why });
    }
  }

  // A record that isn't a handoff fails the step; the Workflow's other record checks are the implement step's own.
  private async _resumedHandoffLaunchOf(
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
  private async _handoffFailureOf(
    ticketRun: TicketRun,
    { error, why }: HandoffFailure,
  ): Promise<unknown> {
    if (!(error instanceof SchemaFailure)) return error;
    await this._snapshot(ticketRun, ticketRun.state.step);
    return new SchemaFailure(
      `${why}, and its handoff record failed: ${error.message}`,
      error.logPath,
    );
  }

  private _implementRulesOf({ run }: TicketRun): ImplementRules {
    return this._agentStepOf(run.spec, "implement");
  }
}
