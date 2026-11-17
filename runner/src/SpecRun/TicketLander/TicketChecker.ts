// A ticket's checks, run in the workspace until green, running the implementer on red, after a handoff past the ticket
// budget; a red master Stops the run, after the same checks run in a master set.
// ../TicketLander.ts delegates its _check here, which TicketSequencer.ts calls after the resolve step.
// It builds its own ReviewStepper, HandoffTaker and HaltRaiser.
// The red-checks prompt is its ticket's Workflow's, through ../../Workflow.ts, and each check runs through ../../runCommand.ts.

import { commandLabelOf, messageOf } from "../../failureText.ts";
import { issueRef } from "../../IssueWorkspaces.ts";
import { runCommand } from "../../runCommand.ts";
import { RunStop } from "../../RunStop.ts";
import { hasAgentStep, missingStepOf } from "../../Workflow.ts";
import { HaltRaiser } from "../HaltRaiser.ts";
import { HandoffTaker } from "../HandoffTaker.ts";
import { ReviewStepper } from "../ReviewStepper.ts";
import { type TicketRun } from "../runState.ts";
import { ticketSteps } from "../runState/ticketSteps.ts";
import { SpecRunBase } from "../SpecRunBase.ts";

export class TicketChecker extends SpecRunBase {
  private get haltRaiser(): HaltRaiser {
    return new HaltRaiser(this.config);
  }

  private get reviewStepper(): ReviewStepper {
    return new ReviewStepper(this.config);
  }

  private get handoffTaker(): HandoffTaker {
    return new HandoffTaker(this.config);
  }

  async _check(ticketRun: TicketRun): Promise<void> {
    await ticketSteps.checkUntilGreen({
      redOf: () => this._redChecksOf(ticketRun),
      sendBack: (failure) => this._resumeOnRedChecks(ticketRun, failure),
    });
  }

  // The first failing check's command and output tail, or the Workflow's ticket checks' failure; undefined when all pass.
  // A red master Stops the run.
  private async _redChecksOf(
    ticketRun: TicketRun,
  ): Promise<string | undefined> {
    const { run, ticket, workspace, state } = ticketRun;
    const workflow = this._ticketWorkflowOf({ ticket, spec: run.spec });
    for (const command of workflow.checks) {
      this._log(
        run,
        `${issueRef.labelOf(ticket.issue)}: checking ${commandLabelOf(command)}.`,
      );
      const failure = await runCommand(command, workspace.path);
      if (failure !== undefined) {
        await this._stopOnRedMaster(ticketRun);
        return `${commandLabelOf(command)} failed:\n${failure}`;
      }
    }
    if (workflow.ticketChecksOf === undefined) return undefined;
    this._log(
      run,
      `${issueRef.labelOf(ticket.issue)}: running the ${workflow.name} checks.`,
    );
    // Master holds no ticket's work, so there is no master set to check.
    return workflow.ticketChecksOf({
      spec: run.spec,
      ticket,
      state,
      workspacePath: workspace.path,
      specClone: this._cloneIn(workspace, run.spec.issue.repo),
    });
  }

  // Checks run in a master set, so neither another session's uncommitted edit nor a local fix hides master's own state.
  private async _stopOnRedMaster({ run, ticket }: TicketRun): Promise<void> {
    const prefix = `Stopped the run at ${issueRef.labelOf(ticket.issue)}'s checks`;
    let masterSet: string;
    try {
      masterSet = await this.workspaces.masterSet(run.spec.issue);
    } catch (error) {
      throw new RunStop(
        `${prefix}: the master set failed to build: ${messageOf(error)}`,
      );
    }
    const { checks } = this._ticketWorkflowOf({ ticket, spec: run.spec });
    for (const command of checks) {
      if ((await runCommand(command, masterSet)) !== undefined) {
        throw new RunStop(`${prefix}: master red: ${commandLabelOf(command)}`);
      }
    }
  }

  // The implementer gets the failure, a fresh session after a handoff.
  private async _resumeOnRedChecks(
    ticketRun: TicketRun,
    failure: string,
  ): Promise<void> {
    const { run, ticket, state } = ticketRun;
    const workflow = this._ticketWorkflowOf({ ticket, spec: run.spec });
    // With no red-checks step to send it back to, a red check is a Failure Halt at once.
    const hasRedChecks = hasAgentStep(workflow, "redChecks");
    await this.haltRaiser._spendRedCheckResume(ticketRun, {
      limit: hasRedChecks ? this.config.knobs.retriesPerFailure : 0,
      failureOf: (resumes) => ({
        step: "checks",
        detail: hasRedChecks
          ? `The checks are still red after ${resumes} resume(s): ${failure}`
          : `The checks are red, and the ${missingStepOf(workflow, "red-checks")}: ${failure}`,
        logPath: state.redChecksLogPath ?? this._progressPathOf(run),
      }),
    });
    await this.handoffTaker._handOffPastBudget(ticketRun, "red-checks");
    this._log(
      run,
      `${issueRef.labelOf(ticket.issue)}: checks red; running the implementer with the failure.`,
    );
    this._markStepStarted(ticketRun);
    const rules = this._ticketAgentStepOf(
      { ticket, spec: run.spec },
      "redChecks",
    );
    const { result, logPath } = await this.reviewStepper._runImplementerStep(
      ticketRun,
      {
        step: "red-checks",
        launch: {
          prompt: rules.promptOf({
            ...ticketSteps.promptFieldsOf(ticketRun),
            failures: failure,
          }),
          jsonSchema: rules.outputSchema,
        },
      },
    );
    state.redChecksLogPath = logPath;
    state.isStepStarted = undefined;
    this._saveState(run);
    // The checks loop judges what a capped implementer committed.
    if (ticketSteps.isTurnCapped(result)) {
      await this._snapshot(ticketRun, "checks");
      return;
    }
    ticketSteps.recordOf("resolve", result, logPath);
  }
}
