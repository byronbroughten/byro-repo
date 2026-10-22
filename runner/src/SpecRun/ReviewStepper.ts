// A ticket's review, finding triage and fix steps. Review records findings; triage gives each a verdict, a Halt verdict
// raising a Halt, with one resumed retry for a refused record. The fix step hands the Fix batch to the resumed implementer
// under the ticket budget, else to the triage agent, resetting a fixer that crosses the live ceiling; a give-up can be a Halt.
// Checks and landing call _runFixerStep to resume a fixer on red checks or a master merge.
// It builds its own HaltRaiser and StepLauncher; prompts are ../reviewStep.ts, ../findingTriage.ts and ../fixStep.ts.

import { join } from "node:path";

import type { StepRequest, StepResult } from "../AgentStep.ts";
import {
  triageOutputSchema,
  triagePrompt,
  type TriageRecord,
  triageRecordProblems,
  triageRecordsOf,
  triageRetryPrompt,
} from "../findingTriage.ts";
import {
  type FixOutcome,
  fixOutcomesOf,
  fixOutputSchema,
  fixPrompt,
  fixRecordProblems,
  type GaveUpOutcome,
  giveUpRecordOf,
} from "../fixStep.ts";
import { git } from "../git.ts";
import { triageHaltOf } from "../halts.ts";
import { issueLabelOf, type Workspace } from "../IssueWorkspaces.ts";
import { strongerPairOf } from "../modelFit.ts";
import {
  reviewPrompt,
  type ReviewRecord,
  reviewRecordSchema,
} from "../reviewStep.ts";
import type { StepAgent } from "../transcriptFacts.ts";
import { UnhandledStop } from "../UnhandledStop.ts";
import { HaltRaiser } from "./HaltRaiser.ts";
import {
  branchedReposOf,
  type Fixer,
  type Heads,
  implementerSessionOf,
  isFix,
  isSameHeads,
  isTurnCapped,
  lastSessionOf,
  launchedOf,
  type LaunchedStep,
  liveCeilingPhraseOf,
  raiseHalts,
  type RanStep,
  recordOf,
  schemaFailureOf,
  type StepLaunch,
  type TicketRun,
  type TicketState,
} from "./runState.ts";
import { SpecRunBase } from "./SpecRunBase.ts";
import { StepLauncher } from "./StepLauncher.ts";

type FixerSession = Pick<StepRequest, "pair" | "resumeSessionId">;

type FixAttempt =
  | { kind: "done"; outcomes: FixOutcome[]; logPath: string }
  | { kind: "crossed"; logPath: string }
  | { kind: "capped" };

export class ReviewStepper extends SpecRunBase {
  private get haltRaiser(): HaltRaiser {
    return new HaltRaiser(this.config);
  }

  private get stepLauncher(): StepLauncher {
    return new StepLauncher(this.config);
  }

  async _review(ticketRun: TicketRun): Promise<void> {
    const { ticket, workspace, state } = ticketRun;
    const { record } = await this._launch(ticketRun, "review", {
      prompt: reviewPrompt({
        issue: ticket.issue,
        title: ticket.title,
        skillName: this.config.knobs.skillNames.review,
        branch: workspace.branch,
        branchedRepos: branchedReposOf(ticketRun),
      }),
      jsonSchema: reviewRecordSchema,
    });
    state.findings = (record as ReviewRecord).findings;
  }

  // Triage never edits, so it runs with no targets; a refused record gets one retry in the same session.
  async _triage(ticketRun: TicketRun): Promise<void> {
    const { ticket, workspace, state } = ticketRun;
    const findings = state.findings ?? [];
    const launch = {
      pair: this.config.knobs.triagePair,
      targets: [],
      jsonSchema: triageOutputSchema,
    };
    const first = await this._launch(ticketRun, "triage", {
      ...launch,
      prompt: triagePrompt({
        issue: ticket.issue,
        title: ticket.title,
        branch: workspace.branch,
        branchedRepos: branchedReposOf(ticketRun),
        findings,
      }),
    });
    let records = triageRecordsOf(first.record);
    const problems = triageRecordProblems(findings.length, records);
    if (problems.length > 0) {
      const retry = await this._launch(ticketRun, "triage", {
        ...launch,
        prompt: triageRetryPrompt(problems),
        resumeSessionId: lastSessionOf(state, "triage"),
      });
      records = triageRecordsOf(retry.record);
      const retryProblems = triageRecordProblems(findings.length, records);
      if (retryProblems.length > 0) {
        throw schemaFailureOf(retry.logPath, {
          problems: retryProblems,
          output: retry.record,
        });
      }
    }
    state.triage = records;
    raiseHalts(ticketRun.run, {
      ticket: ticketRun.ticket.issue,
      drafts: records
        .filter(isHalt)
        .map((record) => triageHaltOf(record, "verdict")),
    });
  }

  // The resumed implementer fixes under the ticket budget; otherwise, or once killed, the triage agent does.
  async _fix(ticketRun: TicketRun): Promise<void> {
    const { run, ticket, workspace, state } = ticketRun;
    const fixes = (state.triage ?? []).filter(isFix);
    if (state.fixBase === undefined) {
      state.fixBase = await this._headsOf(workspace);
      this._saveState(run);
    } else {
      await resetTo(workspace, state.fixBase);
    }
    const base = state.fixBase;
    const peak = state.implementPeak ?? Infinity;
    const isUnderBudget = peak < this.config.knobs.ticketBudget;
    let fixer: Fixer = isUnderBudget ? "implementer" : "triage";
    let attempt = await this._runFixer(ticketRun, fixer, fixes);
    if (attempt.kind === "crossed" && fixer === "implementer") {
      await resetTo(workspace, base);
      this._log(
        run,
        `${issueLabelOf(ticket.issue)}: the implementer's fix crossed the live ceiling; handing the batch to the triage agent.`,
      );
      fixer = "triage";
      attempt = await this._runFixer(ticketRun, fixer, fixes);
    }
    if (attempt.kind === "crossed") {
      await resetTo(workspace, base);
      throw new UnhandledStop(
        "step-error",
        `The triage agent's fix crossed ${liveCeilingPhraseOf(this.config.knobs)}; its work is discarded.`,
        attempt.logPath,
      );
    }
    const { heads, dirtyRepos } = await this._headsAndDirtyReposOf(workspace);
    const hasNewCommit = !isSameHeads(base, heads);
    let outcomes: FixOutcome[];
    if (attempt.kind === "capped") {
      // A capped fixer keeps its commits; only its uncommitted work is set aside.
      await this._snapshot(ticketRun, "fix");
      outcomes = fixes.map(({ finding }) => turnCapGiveUpOf(finding));
    } else {
      outcomes = attempt.outcomes;
      const problems = fixRecordProblems({
        fixes,
        outcomes,
        hasNewCommit,
        dirtyRepos,
      });
      if (problems.length > 0) {
        throw schemaFailureOf(attempt.logPath, { problems, output: outcomes });
      }
    }
    const downstream = await this.haltRaiser._downstreamOf(run, ticket.issue);
    const gaveUps = outcomes.filter(isGaveUp);
    state.triage = (state.triage ?? []).map((record) => {
      const gaveUp = gaveUps.find(({ finding }) => finding === record.finding);
      if (gaveUp === undefined) return record;
      return giveUpRecordOf({ record, gaveUp, downstream });
    });
    const gaveUpHalts = state.triage.filter(
      (record) =>
        isHalt(record) &&
        gaveUps.some(({ finding }) => finding === record.finding),
    );
    raiseHalts(ticketRun.run, {
      ticket: ticketRun.ticket.issue,
      drafts: gaveUpHalts.map((record) => triageHaltOf(record, "give-up")),
    });
    if (hasNewCommit) state.fixer = fixer;
  }

  private async _runFixer(
    ticketRun: TicketRun,
    fixer: Fixer,
    fixes: TriageRecord[],
  ): Promise<FixAttempt> {
    const { ticket, workspace } = ticketRun;
    const { knobs } = this.config;
    const { result, logPath } = await this._runFixerStep(ticketRun, fixer, {
      liveCeiling: knobs.liveCeiling,
      prompt: fixPrompt({
        issue: ticket.issue,
        title: ticket.title,
        branch: workspace.branch,
        branchedRepos: branchedReposOf(ticketRun),
        fixes,
      }),
      jsonSchema: fixOutputSchema,
    });
    if (result.hasCrossedCeiling) return { kind: "crossed", logPath };
    if (isTurnCapped(result)) return { kind: "capped" };
    const record = recordOf("fix", result, logPath);
    return { kind: "done", outcomes: fixOutcomesOf(record), logPath };
  }

  async _runFixerStep(
    ticketRun: TicketRun,
    fixer: Fixer,
    launch: StepLaunch,
  ): Promise<RanStep> {
    const ran = await this.stepLauncher._runStep(ticketRun, "fix", {
      ...this._fixerSessionOf(ticketRun, fixer),
      ...launch,
    });
    const { state } = ticketRun;
    if (fixer === "implementer") noteImplementerResult(state, ran.result);
    return ran;
  }

  private _fixerSessionOf(
    { pair, state }: TicketRun,
    fixer: Fixer,
  ): FixerSession {
    if (fixer === "implementer") {
      return { pair, resumeSessionId: implementerSessionOf(state) };
    }
    return {
      pair: strongerPairOf(this.config.knobs.triagePair, pair),
      resumeSessionId: lastSessionOf(state, "triage"),
    };
  }

  private async _launch(
    ticketRun: TicketRun,
    agent: StepAgent,
    launch: StepLaunch,
  ): Promise<LaunchedStep> {
    return launchedOf(
      agent,
      await this.stepLauncher._runStep(ticketRun, agent, launch),
    );
  }
}

function isHalt({ verdict }: TriageRecord): boolean {
  return verdict === "halt";
}

// Discards commits and untracked files alike; ignored files, such as the symlinked configs, stay.
async function resetTo(workspace: Workspace, heads: Heads): Promise<void> {
  for (const [clonePath, sha] of Object.entries(heads)) {
    const worktree = join(workspace.path, clonePath);
    await git(worktree, "reset", "--hard", sha);
    await git(worktree, "clean", "-fd");
  }
}

function turnCapGiveUpOf(finding: number): GaveUpOutcome {
  return {
    finding,
    status: "gave-up",
    reason: "turn-cap",
    note: "The fixer hit its turn cap before reporting the finding fixed.",
  };
}

function isGaveUp(outcome: FixOutcome): outcome is GaveUpOutcome {
  return outcome.status === "gave-up";
}

// A fix or red-checks step the implementer ran moves its peak and session on.
function noteImplementerResult(
  state: TicketState,
  { peakContext, sessionId }: StepResult,
): void {
  state.implementPeak = peakContext ?? state.implementPeak;
  state.implementerSession = sessionId ?? state.implementerSession;
}
