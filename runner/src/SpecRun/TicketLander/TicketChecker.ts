// A ticket's checks, run in the workspace until green, resuming whoever made the last commit on red;
// a red master Stops the run, after the same checks run in a master set.
// ../TicketLander.ts delegates its _check here, which TicketSequencer.ts calls after the resolve step.
// It builds its own ReviewStepper and HaltRaiser.
// The red-checks prompt is its spec's Workflow's, through ../../Workflow.ts, and each check runs through ../../runCommand.ts.

import { commandLabelOf, messageOf } from "../../failureText.ts";
import { issueRef } from "../../IssueWorkspaces.ts";
import { runCommand } from "../../runCommand.ts";
import { RunStop } from "../../RunStop.ts";
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
    const workflow = this._workflowOf(run.spec);
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
    for (const command of this._workflowOf(run.spec).checks) {
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
    const workflow = this._workflowOf(run.spec);
    // With no red-checks step to send it back to, a red check is a Failure Halt at once.
    const hasRedChecks = workflow.agentSteps.redChecks !== undefined;
    await this.haltRaiser._spendRedCheckResume(ticketRun, {
      limit: hasRedChecks ? this.config.knobs.retriesPerFailure : 0,
      failureOf: (resumes) => ({
        step: "checks",
        detail: hasRedChecks
          ? `The checks are still red after ${resumes} resume(s): ${failure}`
          : `The checks are red, and the ${workflow.name} Workflow has no red-checks step: ${failure}`,
        logPath: state.redChecksLogPath ?? this._progressPathOf(run),
      }),
    });
    let resolver: Resolver = state.resolver ?? "implementer";
    if (resolver === "implementer" && !this._isUnderBudget(state)) {
      resolver = "fresh";
    }
    this._log(
      run,
      `${issueRef.labelOf(ticket.issue)}: checks red; resuming the ${resolverLabels[resolver]} with the failure.`,
    );
    this._markStepStarted(ticketRun);
    const rules = this._agentStepOf(run.spec, "redChecks");
    const { result, logPath } = await this.reviewStepper._runResolverStep(
      ticketRun,
      {
        step: "red-checks",
        resolver,
        launch: {
          prompt: rules.promptOf({
            issue: ticket.issue,
            spec: run.spec.issue,
            title: ticket.title,
            workspacePath: workspace.path,
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
