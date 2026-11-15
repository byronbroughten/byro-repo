// A ticket's implement step: launches it fresh, or continued with more turns or for its record only, and takes its record,
// raising its blockers as Halts. A Workflow that names a kept folder gets it created in the workspace before each launch.
// A handoff launches a fresh step, and one past the live ceiling is resumed for a handoff record only; HandoffTaker.ts
// posts each and halts a fresh step past the handoff cap. A resume hands the ticket's answered Halts to the resumed
// implementer, or to a fresh one past the ticket budget.
// It builds its own HaltRaiser, HandoffTaker and StepLauncher; the step's prompt, schema and checks are its spec's Workflow's, through
// ../Workflow.ts, and the resumes' prompts ../stepPrompts/resumePrompts.ts; the coordinator callers build is ../SpecRun.ts.

import { mkdirSync } from "node:fs";
import { join } from "node:path";

import { freshResumeSection, type Halt, resumePrompt } from "../halts.ts";
import {
  handoffOnlyPrompt,
  moreTurnsPrompt,
  recordOnlyPrompt,
} from "../stepPrompts/resumePrompts.ts";
import { type ImplementRecord } from "../stepRecords.ts";
import { type ImplementRules } from "../Workflow.ts";
import { HaltRaiser } from "./HaltRaiser.ts";
import { HandoffTaker } from "./HandoffTaker.ts";
import {
  type Continuation,
  type Heads,
  type LaunchedStep,
  type RanStep,
  type StepLaunch,
  type TicketRun,
} from "./runState.ts";
import { runHalts } from "./runState/runHalts.ts";
import { ticketSteps } from "./runState/ticketSteps.ts";
import { SpecRunBase } from "./SpecRunBase.ts";
import { StepLauncher } from "./StepLauncher.ts";

interface CeilingCrossing {
  ranStep: RanStep;
  headsBefore: Heads;
}

interface ImplementTake {
  ticketRun: TicketRun;
  launched: LaunchedStep;
  headsBefore: Heads;
}

export class ImplementStepper extends SpecRunBase {
  private get haltRaiser(): HaltRaiser {
    return new HaltRaiser(this.config);
  }

  private get stepLauncher(): StepLauncher {
    return new StepLauncher(this.config);
  }

  private get handoffTaker(): HandoffTaker {
    return new HandoffTaker(this.config);
  }

  async _implement(ticketRun: TicketRun): Promise<void> {
    await this._runImplement(ticketRun, () => this._freshLaunchOf(ticketRun));
  }

  // Each handoff launches a fresh implement step, until one returns another record.
  private async _runImplement(
    ticketRun: TicketRun,
    launchOf: () => StepLaunch,
    onLaunched: () => void = () => {},
  ): Promise<void> {
    let record = await this._runImplementStep(ticketRun, launchOf, onLaunched);
    while (record.status === "handoff") {
      await this.handoffTaker._handOff(ticketRun, {
        handoff: record.handoff,
        point: "in the implement step",
      });
      record = await this._runImplementStep(ticketRun, () =>
        this._freshLaunchOf(ticketRun),
      );
    }
  }

  private _freshLaunchOf(ticketRun: TicketRun): StepLaunch {
    return {
      prompt: this._implementPromptOf(ticketRun),
      jsonSchema: this._implementRulesOf(ticketRun).outputSchema,
    };
  }

  // A continuation keeps the earlier base, so the commits it already made still count as new.
  private async _runImplementStep(
    ticketRun: TicketRun,
    launchOf: () => StepLaunch,
    onLaunched: () => void = () => {},
  ): Promise<ImplementRecord> {
    const { run, workspace, state } = ticketRun;
    const { continuation } = state;
    const { liveCeiling } = this.config.knobs;
    createKeptFolder(ticketRun, this._implementRulesOf(ticketRun));
    let launch: StepLaunch;
    if (continuation === undefined || state.implementBase === undefined) {
      if (state.latestHandoff !== undefined) {
        await this.handoffTaker._haltBeforeFreshStep(
          ticketRun,
          state.latestHandoff,
        );
      }
      state.implementBase = await this._headsOf(workspace);
      this._saveState(run);
      launch = { ...launchOf(), liveCeiling };
    } else {
      launch = continuationLaunchOf(
        ticketRun,
        continuation,
        liveCeiling,
        this._implementRulesOf(ticketRun).outputSchema,
      );
    }
    const headsBefore = state.implementBase;
    const ran = await this.stepLauncher._runStep(
      ticketRun,
      "implement",
      launch,
    );
    state.continuation = undefined;
    onLaunched();
    if (ran.result.hasCrossedCeiling) {
      return this._handOffAtCeiling(ticketRun, { ranStep: ran, headsBefore });
    }
    const launched = ticketSteps.launchedOf("implement", ran);
    return this._takeImplementRecord({ ticketRun, launched, headsBefore });
  }

  private async _handOffAtCeiling(
    ticketRun: TicketRun,
    { ranStep, headsBefore }: CeilingCrossing,
  ): Promise<ImplementRecord> {
    const { ticket } = ticketRun;
    const sessionId = ticketSteps.sessionIdOf(
      ticket.issue,
      "implement step past the live ceiling",
      ranStep.result.sessionId,
    );
    try {
      const { launched } = await this.handoffTaker._resumedHandoffLaunchOf(
        ticketRun,
        { agent: "implement", prompt: handoffOnlyPrompt, sessionId },
      );
      return await this._takeImplementRecord({
        ticketRun,
        launched,
        headsBefore,
      });
    } catch (error) {
      throw await this.handoffTaker._handoffFailureOf(
        ticketRun,
        error,
        `The implement step crossed ${ticketSteps.liveCeilingPhraseOf(this.config.knobs)}`,
      );
    }
  }

  private _implementPromptOf(ticketRun: TicketRun): string {
    const { ticket, workspace, state } = ticketRun;
    return this._implementRulesOf(ticketRun).promptOf({
      ...ticketSteps.promptFieldsOf(ticketRun),
      // The implement step starts from the workspace's own repos, not a record's.
      branchedRepos: workspace.branchedRepos,
      body: ticket.body,
      promoteCommand: this.config.promoteCommandOf(ticket.issue),
      latestHandoff: state.latestHandoff,
    });
  }

  // Each blocker is a Halt; a blocked record, having committed nothing to review, posts them at once.
  private async _takeImplementRecord({
    ticketRun,
    launched,
    headsBefore,
  }: ImplementTake): Promise<ImplementRecord> {
    const { run, ticket, workspace, state } = ticketRun;
    const rules = this._implementRulesOf(ticketRun);
    const record = rules.recordOf(launched.record);
    const { logPath } = launched;
    state.implementPeak = launched.peakContext;
    state.implementerSession = ticketSteps.lastSessionOf(state, "implement");
    const hasNewCommit = !ticketSteps.isSameHeads(
      headsBefore,
      await this._headsOf(workspace),
    );
    // A resumed ticket whose answers needed no change returns its earlier commits again.
    const isRecommit =
      record.status === "committed" && state.record?.status === "committed";
    const problems = rules.recordProblems(
      launched.record,
      hasNewCommit || isRecommit,
      {
        spec: run.spec,
        ticket,
        specClone: this._cloneIn(workspace, run.spec.issue.repo),
      },
    );
    if (problems.length > 0) {
      throw ticketSteps.schemaFailureOf(logPath, {
        problems,
        output: launched.record,
      });
    }
    await this.haltRaiser._raiseBlockerHalts(
      ticketRun,
      record.blockers,
      launched.deniedTools,
    );
    if (record.status === "handoff") return record;
    if (record.status === "blocked") {
      await this.haltRaiser._haltOnUnpostedHalts(ticketRun);
    }
    state.record = record;
    state.latestHandoff = undefined;
    return record;
  }

  // The resumed implementer gets every answer while its session is under the ticket budget and no handoff is pending; otherwise a fresh agent does.
  async _resume(ticketRun: TicketRun): Promise<void> {
    const { run, ticket } = ticketRun;
    const halts = runHalts.undeliveredOf(run, ticket.issue);
    await this._runImplement(
      ticketRun,
      () => this._resumeLaunchOf(ticketRun, halts),
      () => {
        halts.forEach((halt) => {
          halt.isDelivered = true;
        });
      },
    );
  }

  private _resumeLaunchOf(ticketRun: TicketRun, halts: Halt[]): StepLaunch {
    const { state } = ticketRun;
    const { outputSchema } = this._implementRulesOf(ticketRun);
    const sessionId = ticketSteps.implementerSessionOf(state);
    const isUnderBudget = this._isUnderBudget(state);
    const isHandedOff = state.latestHandoff !== undefined;
    if (sessionId !== undefined && isUnderBudget && !isHandedOff) {
      return {
        prompt: resumePrompt(halts),
        resumeSessionId: sessionId,
        jsonSchema: outputSchema,
      };
    }
    // A split Halt's slices may be stale once the developer narrows the ticket, so only its body speaks for them.
    const answered = halts.filter(({ kind }) => kind !== "split");
    if (answered.length === 0) return this._freshLaunchOf(ticketRun);
    return {
      prompt: `${this._implementPromptOf(ticketRun)}\n\n${freshResumeSection(answered)}`,
      jsonSchema: outputSchema,
    };
  }

  private _implementRulesOf({ run }: TicketRun): ImplementRules {
    return this._agentStepOf(run.spec, "implement");
  }
}

// Created on every launch rather than once, so a ticket resumed in a recreated workspace still has it.
function createKeptFolder(
  { ticket, workspace }: TicketRun,
  rules: ImplementRules,
): void {
  if (rules.keptFolderOf === undefined) return;
  mkdirSync(join(workspace.path, rules.keptFolderOf(ticket.issue)), {
    recursive: true,
  });
}

// A record-only retry follows commits, which a handoff record can't have, so it gets no live ceiling.
function continuationLaunchOf(
  ticketRun: TicketRun,
  continuation: Continuation,
  liveCeiling: number,
  jsonSchema: object,
): StepLaunch {
  const { state } = ticketRun;
  const launch = {
    resumeSessionId: ticketSteps.lastSessionOf(state, "implement"),
    jsonSchema,
  };
  if (continuation.kind === "record") {
    return { ...launch, prompt: recordOnlyPrompt };
  }
  const { turns } = continuation;
  const prompt = moreTurnsPrompt(turns, !ticketSteps.isTreeKept(state));
  return { ...launch, prompt, maxTurns: turns, liveCeiling };
}
