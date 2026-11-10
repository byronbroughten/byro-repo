// A ticket's checks, run in the workspace until green, resuming whoever made the last commit on red;
// a red master Stops the run, after the same checks run in a master set.
// ../TicketLander.ts delegates its _check here, which TicketSequencer.ts calls after the resolve step.
// It builds its own ReviewStepper and HaltRaiser.
// The red-checks prompt is its spec's Workflow's, through ../../Workflow.ts, and each check runs through ../../runCommand.ts.

import { commandLabelOf, messageOf } from "../../failureText.ts";
import { issueRef } from "../../IssueWorkspaces.ts";
import { runCommand } from "../../runCommand.ts";
import { RunStop } from "../../RunStop.ts";
import { agentStepsOf } from "../../Workflow.ts";
import { HaltRaiser } from "../HaltRaiser.ts";
import { ReviewStepper } from "../ReviewStepper.ts";
import { type Resolver, type TicketRun } from "../runState.ts";
import { ticketSteps } from "../runState/ticketSteps.ts";
import { SpecRunBase } from "../SpecRunBase.ts";

const resolverLabels: Record<Resolver, string> = {
  implementer: "implementer",
  fresh: "fresh resolver",
};

export class TicketChecker extends SpecRunBase {
  private get haltRaiser(): HaltRaiser {
    return new HaltRaiser(this.config);
  }

  private get reviewStepper(): ReviewStepper {
    return new ReviewStepper(this.config);
  }

  async _check(ticketRun: TicketRun): Promise<void> {
    for (;;) {
      const failure = await this._redChecksOf(ticketRun);
      if (failure === undefined) return;
      await this._resumeOnRedChecks(ticketRun, failure);
    }
  }

  // The first failing check's command and output tail; undefined when all pass. A red master Stops the run.
  private async _redChecksOf(
    ticketRun: TicketRun,
  ): Promise<string | undefined> {
    for (const command of this.config.knobs.checks) {
      this._log(
        ticketRun.run,
        `${issueRef.labelOf(ticketRun.ticket.issue)}: checking ${commandLabelOf(command)}.`,
      );
      const failure = await runCommand(command, ticketRun.workspace.path);
      if (failure !== undefined) {
        await this._stopOnRedMaster(ticketRun);
        return `${commandLabelOf(command)} failed:\n${failure}`;
      }
    }
    return undefined;
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
    for (const command of this.config.knobs.checks) {
      if ((await runCommand(command, masterSet)) !== undefined) {
        throw new RunStop(`${prefix}: master red: ${commandLabelOf(command)}`);
      }
    }
  }

  // Whoever made the last commit gets the failure, the fresh resolver in place of an implementer past the ticket budget.
  private async _resumeOnRedChecks(
    ticketRun: TicketRun,
    failure: string,
  ): Promise<void> {
    const { run, ticket, workspace, state } = ticketRun;
    const { retriesPerFailure } = this.config.knobs;
    const resumes = state.redCheckResumes ?? 0;
    if (resumes >= retriesPerFailure) {
      await this.haltRaiser._failureHalt(ticketRun, {
        step: "checks",
        detail: `The checks are still red after ${resumes} resume(s): ${failure}`,
        logPath: state.redChecksLogPath ?? this._progressPathOf(run),
      });
    }
    state.redCheckResumes = resumes + 1;
    this._saveState(run);
    let resolver: Resolver = state.resolver ?? "implementer";
    if (resolver === "implementer" && !this._isUnderBudget(state)) {
      resolver = "fresh";
    }
    this._log(
      run,
      `${issueRef.labelOf(ticket.issue)}: checks red; resuming the ${resolverLabels[resolver]} with the failure.`,
    );
    this._markStepStarted(ticketRun);
    const rules = agentStepsOf(run.spec).redChecks;
    const { result, logPath } = await this.reviewStepper._runResolverStep(
      ticketRun,
      {
        step: "red-checks",
        resolver,
        launch: {
          prompt: rules.promptOf({
            issue: ticket.issue,
            title: ticket.title,
            branch: workspace.branch,
            branchedRepos: ticketSteps.branchedReposOf(ticketRun),
            failures: failure,
          }),
          jsonSchema: rules.outputSchema,
        },
      },
    );
    state.redChecksLogPath = logPath;
    state.isStepStarted = undefined;
    this._saveState(run);
    // The checks loop judges what a capped resolver committed.
    if (ticketSteps.isTurnCapped(result)) {
      await this._snapshot(ticketRun, "checks");
      return;
    }
    ticketSteps.recordOf("resolve", result, logPath);
  }
}
