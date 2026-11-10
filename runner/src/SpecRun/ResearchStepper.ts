// A piece spec's research ticket's research step: launches it fresh, the developer's answers to its Halts included, and
// keeps its record on the ticket's state once the record passes its checks; a failed check is a SchemaFailure, which
// TicketSequencer.ts raises as a Failure Halt. Any record's blockers halt the ticket at once; a handoff posts
// on the ticket and launches a fresh step, halting first past the handoff cap, as ImplementStepper.ts's does.
// It builds its own HaltRaiser and StepLauncher; the step's prompt, schema and checks are its spec's Workflow's, through ../Workflow.ts.

import { freshResumeSection } from "../halts.ts";
import { issueRef } from "../IssueWorkspaces.ts";
import type { ResearchHandoff, ResearchRecord } from "../stepRecords.ts";
import type { ResearchRules } from "../Workflow.ts";
import { HaltRaiser } from "./HaltRaiser.ts";
import type { TicketRun } from "./runState.ts";
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
  async _research(ticketRun: TicketRun): Promise<void> {
    let record = await this._runResearchStep(ticketRun);
    while (record.status === "handoff") {
      await this._handOff(ticketRun, record.handoff);
      record = await this._runResearchStep(ticketRun);
    }
  }

  private async _runResearchStep(
    ticketRun: TicketRun,
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
