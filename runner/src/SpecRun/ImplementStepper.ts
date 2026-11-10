// A ticket's implement step: launches it fresh, or continued with more turns or for its record only, and takes its record,
// raising its blockers as Halts. A handoff backs up the tree, posts on the ticket and launches a fresh step; one past the
// live ceiling is resumed for a handoff record only. A fresh step past the handoff cap, or after a proposed split, halts first.
// A resume hands the ticket's answered Halts to the resumed implementer, or to a fresh one past the ticket budget.
// It builds its own HaltRaiser and StepLauncher; the step's prompt, schema and checks are its spec's Workflow's, through
// ../Workflow.ts, and the resumes' prompts ../stepPrompts.ts; the coordinator callers build is ../SpecRun.ts.

import { saveUncommitted } from "../git.ts";
import {
  failureOptions,
  freshResumeSection,
  type Halt,
  handoffCapDetailOf,
  resumePrompt,
  runnerMark,
  splitHaltOf,
} from "../halts.ts";
import { type IssueRef, issueRef } from "../IssueWorkspaces.ts";
import { SchemaFailure } from "../SchemaFailure.ts";
import {
  handoffOnlyPrompt,
  moreTurnsPrompt,
  recordOnlyPrompt,
} from "../stepPrompts.ts";
import { type Handoff, type ImplementRecord } from "../stepRecords.ts";
import { agentStepsOf, type ImplementRules } from "../Workflow.ts";
import { HaltRaiser } from "./HaltRaiser.ts";
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
      await this._handOff(ticketRun, record.handoff);
      record = await this._runImplementStep(ticketRun, () =>
        this._freshLaunchOf(ticketRun),
      );
    }
  }

  private _freshLaunchOf(ticketRun: TicketRun): StepLaunch {
    return {
      prompt: this._implementPromptOf(ticketRun),
      jsonSchema: rulesOf(ticketRun).outputSchema,
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
    let launch: StepLaunch;
    if (continuation === undefined || state.implementBase === undefined) {
      if (state.latestHandoff !== undefined) {
        await this._haltBeforeFreshStep(ticketRun, state.latestHandoff);
      }
      state.implementBase = await this._headsOf(workspace);
      this._saveState(run);
      launch = { ...launchOf(), liveCeiling };
    } else {
      launch = continuationLaunchOf(ticketRun, continuation, liveCeiling);
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
    const { ticket, state } = ticketRun;
    const rules = rulesOf(ticketRun);
    const ran = await this.stepLauncher._runStep(ticketRun, "implement", {
      prompt: handoffOnlyPrompt,
      jsonSchema: rules.outputSchema,
      resumeSessionId: sessionIdOf(
        ticket.issue,
        "implement step past the live ceiling",
        ranStep.result.sessionId,
      ),
    });
    try {
      const launched = ticketSteps.launchedOf("implement", ran);
      const { status } = rules.recordOf(launched.record);
      if (status !== "handoff") {
        throw ticketSteps.schemaFailureOf(ran.logPath, {
          problems: [`the record is ${status}, not a handoff`],
          output: launched.record,
        });
      }
      return await this._takeImplementRecord({
        ticketRun,
        launched,
        headsBefore,
      });
    } catch (error) {
      if (!(error instanceof SchemaFailure)) throw error;
      await this._snapshot(ticketRun, state.step);
      // Rethrown so the Failure Halt offers `retry record` when the step had committed.
      throw new SchemaFailure(
        `The implement step crossed ${ticketSteps.liveCeilingPhraseOf(this.config.knobs)}, and its handoff record failed: ${error.message}`,
        error.logPath,
      );
    }
  }

  // The work stays in the tree for the fresh step; the backup branch is in case that step loses it.
  private async _handOff(
    ticketRun: TicketRun,
    handoff: Handoff,
  ): Promise<void> {
    const { run, ticket, state } = ticketRun;
    const sessionId = sessionIdOf(
      ticket.issue,
      "handoff",
      state.implementerSession,
    );
    const count = (state.handoffCount ?? 0) + 1;
    await this._backUp(ticketRun, `handoff-${count}`, saveUncommitted);
    const comment = rulesOf(ticketRun).handoffCommentOf(handoff, sessionId);
    await this.config.github.comment(ticket.issue, `${runnerMark}\n${comment}`);
    state.handoffCount = count;
    state.latestHandoff = handoff;
    this._saveState(run);
    this._log(run, `${issueRef.labelOf(ticket.issue)}: handoff ${count}.`);
  }

  // Checked at each fresh step's launch, so a crash or an answer other than `continue +1 handoff` never skips it.
  private async _haltBeforeFreshStep(
    ticketRun: TicketRun,
    { proposedSplit }: Handoff,
  ): Promise<void> {
    const { run, ticket, state } = ticketRun;
    const count = state.handoffCount ?? 0;
    const cap =
      this.config.knobs.handoffsPerTicket + (state.extraHandoffs ?? 0);
    const isSplitUnhalted =
      proposedSplit !== undefined && state.splitHaltedHandoff !== count;
    if (count > cap) {
      if (isSplitUnhalted) state.splitHaltedHandoff = count;
      await this.haltRaiser._failureHalt(ticketRun, {
        step: state.step,
        detail: handoffCapDetailOf({
          ticket: ticket.issue,
          count,
          cap,
          slices: isSplitUnhalted ? proposedSplit : [],
        }),
        logPath: this._progressPathOf(run),
        options: [failureOptions.moreHandoffs],
      });
    }
    if (!isSplitUnhalted) return;
    const downstream = await this.haltRaiser._downstreamOf(run, ticket.issue);
    runHalts.raise(run, {
      ticket: ticket.issue,
      drafts: [splitHaltOf(proposedSplit, downstream)],
    });
    state.splitHaltedHandoff = count;
    await this.haltRaiser._haltOnUnpostedHalts(ticketRun);
  }

  private _implementPromptOf(ticketRun: TicketRun): string {
    const { ticket, workspace, state } = ticketRun;
    return rulesOf(ticketRun).promptOf({
      issue: ticket.issue,
      title: ticket.title,
      body: ticket.body,
      branch: workspace.branch,
      branchedRepos: workspace.branchedRepos,
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
    const { workspace, state } = ticketRun;
    const rules = rulesOf(ticketRun);
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
    const problems = rules.recordProblems(record, hasNewCommit || isRecommit);
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
    const { outputSchema } = rulesOf(ticketRun);
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
}

// A record-only retry follows commits, which a handoff record can't have, so it gets no live ceiling.
function continuationLaunchOf(
  ticketRun: TicketRun,
  continuation: Continuation,
  liveCeiling: number,
): StepLaunch {
  const { state } = ticketRun;
  const launch = {
    resumeSessionId: ticketSteps.lastSessionOf(state, "implement"),
    jsonSchema: rulesOf(ticketRun).outputSchema,
  };
  if (continuation.kind === "record") {
    return { ...launch, prompt: recordOnlyPrompt };
  }
  const { turns } = continuation;
  const prompt = moreTurnsPrompt(turns, !ticketSteps.isTreeKept(state));
  return { ...launch, prompt, maxTurns: turns, liveCeiling };
}

function rulesOf({ run }: TicketRun): ImplementRules {
  return agentStepsOf(run.spec).implement;
}

function sessionIdOf(
  issue: IssueRef,
  owner: string,
  sessionId: string | undefined,
): string {
  if (sessionId === undefined) {
    throw new Error(`${issueRef.labelOf(issue)}'s ${owner} has no session id.`);
  }
  return sessionId;
}
