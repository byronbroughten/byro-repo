// A piece spec's research ticket's research step: launches it fresh, the developer's answers to its Halts included, and
// keeps its record on the ticket's state once the record passes its checks; a failed check is a SchemaFailure, which
// TicketSequencer.ts raises as a Failure Halt. Any record's blockers halt the ticket at once; a handoff posts
// on the ticket and launches a fresh step, halting first past the handoff cap, as ImplementStepper.ts's does.
// Its _checkQuotes is the ticket's checks step: the Workflow's quote check, red sending the step back once, then a Failure Halt.
// It builds its own HaltRaiser and StepLauncher; the step's prompt, schema and checks are its spec's Workflow's, through ../Workflow.ts.

import { commandLabelOf } from "../failureText.ts";
import { freshResumeSection } from "../halts.ts";
import { issueRef } from "../IssueWorkspaces.ts";
import { runCommand } from "../runCommand.ts";
import type {
  ReadyResearchRecord,
  ResearchHandoff,
  ResearchRecord,
} from "../stepRecords.ts";
import type { RedQuotes, ResearchRules } from "../Workflow.ts";
import { HaltRaiser } from "./HaltRaiser.ts";
import type { LandingTicket, TicketRun } from "./runState.ts";
import { runHalts } from "./runState/runHalts.ts";
import { ticketSteps } from "./runState/ticketSteps.ts";
import { SpecRunBase } from "./SpecRunBase.ts";
import { StepLauncher } from "./StepLauncher.ts";

export class ResearchStepper extends SpecRunBase {
  private get haltRaiser(): HaltRaiser {
    return new HaltRaiser(this.config);
  }

  private get stepLauncher(): StepLauncher {
    return new StepLauncher(this.config);
  }

  // Each handoff launches a fresh research step, until one returns another record.
  async _research(ticketRun: TicketRun, redQuotes?: RedQuotes): Promise<void> {
    let record = await this._runResearchStep(ticketRun, redQuotes);
    while (record.status === "handoff") {
      await this._handOff(ticketRun, record.handoff);
      record = await this._runResearchStep(ticketRun, redQuotes);
    }
  }

  // Red quotes send the research step back with the failure, up to the retriesPerFailure knob, then raise a Failure Halt.
  async _checkQuotes(ticketRun: TicketRun): Promise<void> {
    for (;;) {
      const record = readyRecordOf(ticketRun);
      const failure = await this._redQuotesOf(ticketRun, record);
      if (failure === undefined) return;
      await this._sendBackOnRedQuotes(ticketRun, { record, failure });
    }
  }

  private async _redQuotesOf(
    { run, ticket, workspace }: TicketRun,
    record: ReadyResearchRecord,
  ): Promise<string | undefined> {
    const command = this._agentStepOf(run.spec, "research").quoteCheckOf(
      record,
    );
    this._log(
      run,
      `${issueRef.labelOf(ticket.issue)}: checking ${commandLabelOf(command)}.`,
    );
    const failure = await runCommand(command, workspace.path);
    if (failure === undefined) return undefined;
    return `${commandLabelOf(command)} failed:\n${failure}`;
  }

  private async _sendBackOnRedQuotes(
    ticketRun: TicketRun,
    redQuotes: RedQuotes,
  ): Promise<void> {
    const { run, ticket, state } = ticketRun;
    const resumes = state.redCheckResumes ?? 0;
    if (resumes >= this.config.knobs.retriesPerFailure) {
      await this.haltRaiser._failureHalt(ticketRun, {
        step: "checks",
        detail: `The quote check is still red after ${resumes} research step(s) sent back: ${redQuotes.failure}`,
        logPath: this._progressPathOf(run),
      });
    }
    state.redCheckResumes = resumes + 1;
    this._saveState(run);
    this._log(
      run,
      `${issueRef.labelOf(ticket.issue)}: quote check red; sending the research step back with the failure.`,
    );
    this._markStepStarted(ticketRun);
    await this._research(ticketRun, redQuotes);
    state.isStepStarted = undefined;
    this._saveState(run);
  }

  private async _runResearchStep(
    ticketRun: TicketRun,
    redQuotes: RedQuotes | undefined,
  ): Promise<ResearchRecord> {
    const { run, ticket, workspace, state } = ticketRun;
    if (state.latestResearchHandoff !== undefined) {
      await this.haltRaiser._haltPastHandoffCap(ticketRun, []);
    }
    const rules = this._researchRulesOf(ticketRun);
    const halts = runHalts.undeliveredOf(run, ticket.issue);
    const prompt = rules.promptOf({
      issue: ticket.issue,
      title: ticket.title,
      body: ticket.body,
      latestHandoff: state.latestResearchHandoff,
      redQuotes,
    });
    const ran = await this.stepLauncher._runStep(ticketRun, "research", {
      prompt:
        halts.length === 0
          ? prompt
          : `${prompt}\n\n${freshResumeSection(halts)}`,
      jsonSchema: rules.outputSchema,
    });
    halts.forEach((halt) => {
      halt.isDelivered = true;
    });
    const launched = ticketSteps.launchedOf("research", ran);
    const problems = rules.recordProblems(launched.record, workspace.path);
    if (problems.length > 0) {
      throw ticketSteps.schemaFailureOf(launched.logPath, {
        problems,
        output: launched.record,
      });
    }
    const record = rules.recordOf(launched.record);
    await this.haltRaiser._raiseBlockerHalts(
      ticketRun,
      record.blockers,
      launched.deniedTools,
    );
    if (record.status === "handoff") return record;
    // Kept before its blockers halt the ticket, a blocked record's and a ready one's alike, since no later step posts them.
    state.researchRecord = record;
    state.latestResearchHandoff = undefined;
    this._saveState(run);
    await this.haltRaiser._haltOnUnpostedHalts(ticketRun);
    return record;
  }

  private async _handOff(
    ticketRun: TicketRun,
    handoff: ResearchHandoff,
  ): Promise<void> {
    const { ticket, state } = ticketRun;
    const sessionId = ticketSteps.lastSessionOf(state, "research");
    if (sessionId === undefined) {
      throw new Error(
        `${issueRef.labelOf(ticket.issue)}'s research handoff has no session id.`,
      );
    }
    const comment = this._researchRulesOf(ticketRun).handoffCommentOf(
      handoff,
      sessionId,
    );
    state.latestResearchHandoff = handoff;
    await this._postHandoff(ticketRun, comment);
  }

  private _researchRulesOf({ run }: TicketRun): ResearchRules {
    return this._agentStepOf(run.spec, "research");
  }
}

// The research step keeps only a ready record without halting the ticket, so the checks never meet another.
export function readyRecordOf({
  ticket,
  state,
}: LandingTicket): ReadyResearchRecord {
  const record = state.researchRecord;
  if (record?.status !== "ready") {
    throw new Error(
      `${issueRef.labelOf(ticket.issue)} reached its ${state.step} step with no ready research record`,
    );
  }
  return record;
}
