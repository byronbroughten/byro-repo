// A ticket's review and resolve steps. Review records findings; resolve gives each a verdict and fixes the Fix ones in one
// session, the resumed implementer under the ticket budget, else a fresh resolver, resetting one that crosses the live
// ceiling; a refused record gets one resumed retry and a Halt verdict raises a Halt.
// Checks and landing call _runFixerStep to resume a resolver on red checks or a master merge.
// It builds its own HaltRaiser and StepLauncher; prompts are ../reviewStep.ts and ../findingTriage.ts.

import { join } from "node:path";

import type { StepRequest, StepResult } from "../AgentStep.ts";
import {
  resolveCommitProblems,
  resolvePrompt,
  resolveRetryPrompt,
  triageOutputSchema,
  type TriageRecord,
  triageRecordProblems,
  triageRecordsOf,
  withReviewerFields,
} from "../findingTriage.ts";
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
  turnCapDetailOf,
} from "./runState.ts";
import { SpecRunBase } from "./SpecRunBase.ts";
import { StepLauncher } from "./StepLauncher.ts";

type FixerSession = Pick<StepRequest, "pair" | "resumeSessionId">;

interface DoneAttempt {
  kind: "done";
  records: TriageRecord[];
  logPath: string;
}

interface ResolveCheck {
  fixer: Fixer;
  // The heads the resolve started on.
  base: Heads;
  attempt: DoneAttempt;
}

type ResolveAttempt =
  | DoneAttempt
  | { kind: "crossed"; logPath: string }
  | { kind: "capped"; logPath: string };

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

  // The resumed implementer resolves under the ticket budget; otherwise, or once killed, a fresh resolver does.
  // A turn cap is a crash: the work is reset away and the resolve runs again.
  async _resolve(ticketRun: TicketRun): Promise<void> {
    const { run, ticket, workspace, state } = ticketRun;
    if (state.fixBase === undefined) {
      state.fixBase = await this._headsOf(workspace);
      this._saveState(run);
    } else {
      await resetTo(workspace, state.fixBase);
    }
    const base = state.fixBase;
    for (;;) {
      let fixer: Fixer = this._isUnderBudget(state) ? "implementer" : "triage";
      let attempt = await this._runResolver(ticketRun, fixer);
      if (attempt.kind === "crossed" && fixer === "implementer") {
        await resetTo(workspace, base);
        this._log(
          run,
          `${issueLabelOf(ticket.issue)}: the implementer's resolve crossed the live ceiling; handing the findings to a fresh resolver.`,
        );
        fixer = "triage";
        attempt = await this._runResolver(ticketRun, fixer);
      }
      if (attempt.kind === "crossed") {
        await resetTo(workspace, base);
        throw new UnhandledStop(
          "step-error",
          `The fresh resolver crossed ${liveCeilingPhraseOf(this.config.knobs)}; its work is discarded.`,
          attempt.logPath,
        );
      }
      if (attempt.kind === "capped") {
        const turns = this.config.knobs.maxTurns.fix;
        await this.haltRaiser._takeCrash(ticketRun, {
          detail: turnCapDetailOf("fix", turns),
          logPath: attempt.logPath,
        });
        await resetTo(workspace, base);
        continue;
      }
      const records = await this._checkedRecordsOf(ticketRun, {
        fixer,
        base,
        attempt,
      });
      state.triage = records;
      if (!isSameHeads(base, await this._headsOf(workspace))) {
        state.fixer = fixer;
      }
      raiseHalts(run, {
        ticket: ticket.issue,
        drafts: records.filter(isHalt).map(triageHaltOf),
      });
      return;
    }
  }

  // A refused record gets one retry in the same session.
  private async _checkedRecordsOf(
    ticketRun: TicketRun,
    { fixer, base, attempt }: ResolveCheck,
  ): Promise<TriageRecord[]> {
    let { records, logPath } = attempt;
    let problems = await this._resolveProblemsOf(ticketRun, base, records);
    if (problems.length === 0) return records;
    const retry = await this._retryResolver(ticketRun, fixer, problems);
    if (retry.kind !== "done") {
      throw new UnhandledStop(
        "step-error",
        "The resolver's retry for a refused record ended before returning its records.",
        retry.logPath,
      );
    }
    ({ records, logPath } = retry);
    problems = await this._resolveProblemsOf(ticketRun, base, records);
    if (problems.length > 0) {
      throw schemaFailureOf(logPath, { problems, output: records });
    }
    return records;
  }

  private async _resolveProblemsOf(
    { workspace, state }: TicketRun,
    base: Heads,
    records: TriageRecord[],
  ): Promise<string[]> {
    const findingCount = (state.findings ?? []).length;
    const { dirtyRepos } = await this._headsAndDirtyReposOf(workspace);
    const hasChangedTree = await hasChangedTreeSince(workspace, base);
    return [
      ...triageRecordProblems(findingCount, records),
      ...resolveCommitProblems({ records, hasChangedTree, dirtyRepos }),
    ];
  }

  // A first launch, so a fresh resolver starts a new session.
  private async _runResolver(
    ticketRun: TicketRun,
    fixer: Fixer,
  ): Promise<ResolveAttempt> {
    const { ticket, workspace, state } = ticketRun;
    const prompt = resolvePrompt({
      issue: ticket.issue,
      title: ticket.title,
      branch: workspace.branch,
      branchedRepos: branchedReposOf(ticketRun),
      findings: state.findings ?? [],
    });
    if (fixer === "triage") {
      return this._launchResolver(ticketRun, fixer, {
        prompt,
        resumeSessionId: undefined,
      });
    }
    return this._launchResolver(ticketRun, fixer, { prompt });
  }

  // Resumes the session that returned the refused record.
  private async _retryResolver(
    ticketRun: TicketRun,
    fixer: Fixer,
    problems: string[],
  ): Promise<ResolveAttempt> {
    return this._launchResolver(ticketRun, fixer, {
      prompt: resolveRetryPrompt(problems),
    });
  }

  private async _launchResolver(
    ticketRun: TicketRun,
    fixer: Fixer,
    launch: Pick<StepLaunch, "prompt" | "resumeSessionId">,
  ): Promise<ResolveAttempt> {
    const { result, logPath } = await this._runFixerStep(ticketRun, fixer, {
      liveCeiling: this.config.knobs.liveCeiling,
      jsonSchema: triageOutputSchema,
      ...launch,
    });
    if (result.hasCrossedCeiling) return { kind: "crossed", logPath };
    if (isTurnCapped(result)) return { kind: "capped", logPath };
    const record = recordOf("fix", result, logPath);
    const findings = ticketRun.state.findings ?? [];
    const records = withReviewerFields(triageRecordsOf(record), findings);
    return { kind: "done", records, logPath };
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
    if (fixer === "triage") {
      state.triageSession = ran.result.sessionId ?? state.triageSession;
    }
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
      resumeSessionId: state.triageSession ?? lastSessionOf(state, "triage"),
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

async function hasChangedTreeSince(
  workspace: Workspace,
  heads: Heads,
): Promise<boolean> {
  for (const [clonePath, sha] of Object.entries(heads)) {
    const worktree = join(workspace.path, clonePath);
    const before = await git(worktree, "rev-parse", `${sha}^{tree}`);
    const after = await git(worktree, "rev-parse", "HEAD^{tree}");
    if (before !== after) return true;
  }
  return false;
}

// A resolve or red-checks step the implementer ran moves its peak and session on.
function noteImplementerResult(
  state: TicketState,
  { peakContext, sessionId }: StepResult,
): void {
  state.implementPeak = peakContext ?? state.implementPeak;
  state.implementerSession = sessionId ?? state.implementerSession;
}
