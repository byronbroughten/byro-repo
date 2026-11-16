// A ticket's review and resolve steps, both the implementer's. Review records findings, in the implementer's session or,
// for a session review, a fresh review session, resumed once when over the inline size it skipped its reviewer subagents;
// the implementer resolves them, giving each a verdict and fixing the Fix ones. A fresh session after a handoff carries
// either step on; a resolve record that breaks the rules gets one resumed retry, apart from the launcher's one schema
// resume, and a Halt verdict raises a Halt. Before review and resolve, an implementer past the ticket budget hands off;
// killed at the live ceiling during either, it hands off at once.
// Checks and landing call _runImplementerStep to run the implementer on red checks or a master merge.
// It builds its own HaltRaiser, HandoffTaker and StepLauncher; each step's prompt, schema and checks are its spec's
// Workflow's, through ../Workflow.ts.

import { join } from "node:path";

import type { StepResult } from "../AgentStep.ts";
import { git, lines } from "../git.ts";
import { verdictHaltOf } from "../halts.ts";
import { issueRef, type Workspace } from "../IssueWorkspaces.ts";
import { schemaProblemsOf } from "../recordSchema.ts";
import { handoffText } from "../stepPrompts/handoffText.ts";
import {
  type Finding,
  pointsWorthCheckingOf,
  type ResolveRecord,
  type ReviewRecord,
} from "../stepRecords.ts";
import {
  type ResolvePromptInput,
  type ResolveRules,
  type ReviewerCheck,
} from "../Workflow.ts";
import { HaltRaiser } from "./HaltRaiser.ts";
import { type BoundaryStep, HandoffTaker } from "./HandoffTaker.ts";
import {
  type Heads,
  type RanStep,
  type StepLaunch,
  type TicketRun,
  type TicketState,
} from "./runState.ts";
import { runHalts } from "./runState/runHalts.ts";
import { ticketSteps } from "./runState/ticketSteps.ts";
import { SpecRunBase } from "./SpecRunBase.ts";
import { StepLauncher } from "./StepLauncher.ts";

// Names the launch in the progress log; red checks and merge-master run as the resolve agent too.
type ImplementerStep = BoundaryStep;

// A fresh session gets freshPrompt when the resume's own prompt leans on the lost conversation.
interface ImplementerLaunch {
  step: ImplementerStep;
  launch: StepLaunch;
  freshPrompt?: string;
}

interface ReviewLaunch extends Omit<ImplementerLaunch, "step"> {
  isSessionReview: boolean;
}

// Unset reviewerCheck never sends the review back: a Workflow with none, or a diff within the inline size.
interface ReviewAttempt extends Omit<ReviewLaunch, "freshPrompt"> {
  reviewerCheck?: ReviewerCheck;
}

interface ReviewerResume {
  ran: RanStep;
  reviewerCheck: ReviewerCheck;
  // The review's own launch, whose prompt a fresh rerun of the resume takes.
  launch: StepLaunch;
  isSessionReview: boolean;
}

type ResolveOutcome =
  | { kind: "done"; records: ResolveRecord[]; logPath: string }
  | { kind: "crossed"; logPath: string; sessionId: string | undefined }
  | { kind: "capped"; logPath: string };

// Names whether its schema resume was spent.
type ResolveAttempt = ResolveOutcome & Pick<RanStep, "isSchemaResumed">;

// The rule resume skips the schema resume its attempt's first launch already spent.
interface RuleResume {
  problems: string[];
  isSchemaResumed: boolean;
}

interface ResolveRun {
  ranStep: RanStep;
  findings: Finding[];
  rules: ResolveRules;
}

interface KeptRecords {
  // The heads the resolve started on.
  base: Heads;
  records: ResolveRecord[];
}

export class ReviewStepper extends SpecRunBase {
  private get haltRaiser(): HaltRaiser {
    return new HaltRaiser(this.config);
  }

  private get stepLauncher(): StepLauncher {
    return new StepLauncher(this.config);
  }

  private get handoffTaker(): HandoffTaker {
    return new HandoffTaker(this.config);
  }

  // An implementer past the ticket budget hands off first, while its cache is still warm.
  async _review(ticketRun: TicketRun): Promise<void> {
    await this.handoffTaker._handOffPastBudget(ticketRun, "review");
    const { run, state } = ticketRun;
    const rules = this._agentStepOf(run.spec, "review");
    const { reviewerCheck, outputSchema: jsonSchema } = rules;
    const isInlineAllowed =
      reviewerCheck?.offersInline === true &&
      (await this._isInlineSize(ticketRun));
    const isSessionReview = run.sessionReview !== undefined;
    const launch: StepLaunch = {
      prompt: rules.promptOf({
        ...ticketSteps.promptFieldsOf(ticketRun),
        skillName: rules.skillName,
        isInlineAllowed,
        isSessionReview,
        pointsWorthChecking: pointsWorthCheckingOf(state.record),
      }),
      jsonSchema,
      // A session review's fresh review session has no implementer to hand off.
      liveCeiling: isSessionReview ? undefined : this.config.knobs.liveCeiling,
    };
    const attempt: ReviewAttempt = {
      launch,
      isSessionReview,
      reviewerCheck: isInlineAllowed ? undefined : reviewerCheck,
    };
    let ran = await this._reviewOnce(ticketRun, attempt);
    // The review changes nothing, so the fresh session after the handoff reviews again from the start.
    while (ran.result.hasCrossedCeiling) {
      await this.handoffTaker._handOffAtCeiling(ticketRun, {
        agent: "review",
        crossedSession: ran.result.sessionId,
      });
      ran = await this._reviewOnce(ticketRun, attempt);
    }
    const { record, logPath } = ticketSteps.launchedOf("review", ran);
    const problems = schemaProblemsOf(rules.outputSchema, record);
    if (problems.length > 0) {
      throw ticketSteps.schemaFailureOf(logPath, { problems, output: record });
    }
    const { findings, dismissedOverlaps } = record as ReviewRecord;
    state.findings = findings;
    state.dismissedOverlaps = dismissedOverlaps;
  }

  // A review the live ceiling killed isn't sent back for its reviewers: its handoff comes first.
  private async _reviewOnce(
    ticketRun: TicketRun,
    { launch, isSessionReview, reviewerCheck }: ReviewAttempt,
  ): Promise<RanStep> {
    const ran = await this._runReviewSession(ticketRun, {
      launch,
      isSessionReview,
    });
    ticketRun.state.hasSkippedReviewers = undefined;
    if (reviewerCheck === undefined || ran.result.hasCrossedCeiling) return ran;
    return this._sentBackForReviewers(ticketRun, {
      ran,
      reviewerCheck,
      launch,
      isSessionReview,
    });
  }

  // A resume that finds no conversation runs fresh, a session review's as the implementer's does.
  private async _runReviewSession(
    ticketRun: TicketRun,
    { launch, isSessionReview, freshPrompt }: ReviewLaunch,
  ): Promise<RanStep> {
    if (!isSessionReview) {
      return this._runImplementerStep(ticketRun, {
        step: "review",
        launch,
        freshPrompt,
      });
    }
    // A session review has no implementer session to resume, so it runs in a fresh review session of its own.
    const ran = await this.stepLauncher._runStep(ticketRun, "review", launch);
    if (!ran.result.hasNoConversation) return ran;
    this._log(
      ticketRun.run,
      `${issueRef.labelOf(ticketRun.ticket.issue)}: the review step's session ${launch.resumeSessionId} has no conversation; running it as a fresh session.`,
    );
    return this.stepLauncher._runStep(ticketRun, "review", {
      ...launch,
      prompt: freshPrompt ?? launch.prompt,
      resumeSessionId: undefined,
    });
  }

  // A review that spawned fewer reviewers than its Workflow names is resumed once; a second skip is recorded for its review list.
  private async _sentBackForReviewers(
    ticketRun: TicketRun,
    { ran, reviewerCheck, launch, isSessionReview }: ReviewerResume,
  ): Promise<RanStep> {
    const { run, ticket, state } = ticketRun;
    const label = issueRef.labelOf(ticket.issue);
    const { count, resumePrompt } = reviewerCheck;
    const spawned = ran.result.spawnedSubagentCount;
    if (spawned >= count) return ran;
    this._log(
      run,
      `${label}: the review ${spawnedPhraseOf(spawned, count)}; resuming it to spawn them.`,
    );
    const resumed = await this._runReviewSession(ticketRun, {
      launch: {
        prompt: resumePrompt,
        jsonSchema: launch.jsonSchema,
        liveCeiling: launch.liveCeiling,
        resumeSessionId: ran.result.sessionId,
      },
      isSessionReview,
      freshPrompt: launch.prompt,
    });
    if (resumed.result.hasCrossedCeiling) return resumed;
    const total = spawned + resumed.result.spawnedSubagentCount;
    if (total < count) {
      state.hasSkippedReviewers = true;
      this._log(
        run,
        `${label}: the review, once resumed, ${spawnedPhraseOf(total, count)}; its review list says it ran without its reviewers.`,
      );
    }
    return resumed;
  }

  // Counted from master, the review's own fixed point, so a session review with no implement base counts the same files.
  private async _isInlineSize(ticketRun: TicketRun): Promise<boolean> {
    let count = 0;
    for (const repo of ticketSteps.branchedReposOf(ticketRun)) {
      const worktree = this._cloneIn(ticketRun.workspace, repo);
      const files = await git(worktree, "diff", "--name-only", "master...HEAD");
      count += lines(files).length;
    }
    return count <= this.config.knobs.inlineReviewMaxFiles;
  }

  // A turn cap is a crash, its work reset away; a crossed live ceiling hands off, its work kept for the fresh session.
  async _resolve(ticketRun: TicketRun): Promise<void> {
    const { run, workspace, state } = ticketRun;
    if (state.resolveBase === undefined) {
      state.resolveBase = await this._headsOf(workspace);
      this._saveState(run);
    } else if (state.latestHandoff === undefined) {
      await resetTo(workspace, state.resolveBase);
    }
    await this.handoffTaker._handOffPastBudget(ticketRun, "resolve");
    const base = state.resolveBase;
    let attempt = await this._runResolver(ticketRun);
    let isRetry = false;
    for (;;) {
      if (attempt.kind === "crossed") {
        await this.handoffTaker._handOffAtCeiling(ticketRun, {
          agent: "resolve",
          crossedSession: attempt.sessionId,
        });
      } else if (attempt.kind === "capped") {
        const turns = this.config.knobs.maxTurns.resolve;
        await this.haltRaiser._takeCrash(ticketRun, {
          detail: ticketSteps.turnCapDetailOf("resolve", turns),
          logPath: attempt.logPath,
        });
        await resetTo(workspace, base);
      } else {
        const { records, logPath } = attempt;
        const problems = await this._resolveProblemsOf(
          ticketRun,
          base,
          records,
        );
        if (problems.length === 0) {
          await this._keepRecords(ticketRun, { base, records });
          return;
        }
        if (isRetry) {
          throw ticketSteps.schemaFailureOf(logPath, {
            problems,
            output: records,
          });
        }
        isRetry = true;
        attempt = await this._retryResolver(ticketRun, {
          problems,
          isSchemaResumed: attempt.isSchemaResumed === true,
        });
        continue;
      }
      isRetry = false;
      attempt = await this._runResolver(ticketRun);
    }
  }

  async _keepRecords(
    ticketRun: TicketRun,
    { base, records }: KeptRecords,
  ): Promise<void> {
    const { run, ticket, workspace, state } = ticketRun;
    state.resolveRecords = records;
    if (!ticketSteps.isSameHeads(base, await this._headsOf(workspace))) {
      state.hasFixes = true;
    }
    runHalts.raise(run, {
      ticket: ticket.issue,
      drafts: records.filter(isHalt).map(verdictHaltOf),
    });
  }

  async _resolveProblemsOf(
    ticketRun: TicketRun,
    base: Heads,
    records: ResolveRecord[],
  ): Promise<string[]> {
    const { workspace, state } = ticketRun;
    const rules = this._resolveRulesOf(ticketRun);
    const findingCount = (state.findings ?? []).length;
    const { dirtyRepos } = await this._headsAndDirtyReposOf(workspace);
    const hasChangedTree = await hasChangedTreeSince(workspace, base);
    return [
      ...rules.recordProblems(findingCount, records),
      ...rules.commitProblems({ records, hasChangedTree, dirtyRepos }),
    ];
  }

  private async _runResolver(ticketRun: TicketRun): Promise<ResolveAttempt> {
    const prompt = this._resolveRulesOf(ticketRun).promptOf(
      resolvePromptInputOf(ticketRun),
    );
    return this._launchResolver(ticketRun, { prompt });
  }

  // Resumes the session that returned the refused record; a fresh session gets the step's prompt beside the refusal.
  private async _retryResolver(
    ticketRun: TicketRun,
    { problems, isSchemaResumed }: RuleResume,
  ): Promise<ResolveAttempt> {
    const { promptOf, retryPromptOf } = this._resolveRulesOf(ticketRun);
    return this._launchResolver(
      ticketRun,
      { prompt: retryPromptOf(problems), skipSchemaResume: isSchemaResumed },
      `${promptOf(resolvePromptInputOf(ticketRun))}\n\n${retryPromptOf(problems)}`,
    );
  }

  private async _launchResolver(
    ticketRun: TicketRun,
    launch: Pick<StepLaunch, "prompt" | "skipSchemaResume">,
    freshPrompt?: string,
  ): Promise<ResolveAttempt> {
    const rules = this._resolveRulesOf(ticketRun);
    const ran = await this._runImplementerStep(ticketRun, {
      step: "resolve",
      launch: {
        liveCeiling: this.config.knobs.liveCeiling,
        jsonSchema: rules.outputSchema,
        ...launch,
      },
      freshPrompt,
    });
    const findings = ticketRun.state.findings ?? [];
    return {
      ...resolveOutcomeOf({ ranStep: ran, findings, rules }),
      isSchemaResumed: ran.isSchemaResumed,
    };
  }

  // A resume that finds no conversation runs fresh on the ticket's pair, as a pending handoff does.
  async _runImplementerStep(
    ticketRun: TicketRun,
    { step, launch, freshPrompt }: ImplementerLaunch,
  ): Promise<RanStep> {
    const { run, ticket, state } = ticketRun;
    const sessionId = ticketSteps.implementerSessionOf(state);
    if (state.latestHandoff === undefined && sessionId !== undefined) {
      const ran = await this._runImplementerSession(
        ticketRun,
        { ...launch, resumeSessionId: sessionId },
        step,
      );
      if (!ran.result.hasNoConversation) return ran;
      this._log(
        run,
        `${issueRef.labelOf(ticket.issue)}: the ${step} step's session ${sessionId} has no conversation; running it as a fresh session.`,
      );
    }
    return this._runFreshImplementer(ticketRun, { step, launch, freshPrompt });
  }

  // A pending handoff's section rides on the prompt, after the handoff cap's and a proposed split's Halts.
  private async _runFreshImplementer(
    ticketRun: TicketRun,
    { step, launch, freshPrompt }: ImplementerLaunch,
  ): Promise<RanStep> {
    const { state } = ticketRun;
    const handoff = state.latestHandoff;
    let prompt = freshPrompt ?? launch.prompt;
    if (handoff !== undefined) {
      await this.handoffTaker._haltBeforeFreshStep(ticketRun, handoff);
      prompt = `${prompt}\n\n${handoffText.previousSectionOf(handoff)}`;
    }
    // The session it replaces measured its own context, not this one's.
    state.implementPeak = undefined;
    return this._runImplementerSession(
      ticketRun,
      { ...launch, prompt, resumeSessionId: undefined },
      step,
    );
  }

  private async _runImplementerSession(
    ticketRun: TicketRun,
    launch: StepLaunch,
    step: ImplementerStep,
  ): Promise<RanStep> {
    const agent = step === "review" ? "review" : "resolve";
    const ran = await this.stepLauncher._runStep(ticketRun, agent, launch);
    noteImplementerResult(ticketRun.state, ran.result);
    return ran;
  }

  private _resolveRulesOf({ run }: TicketRun): ResolveRules {
    return this._agentStepOf(run.spec, "resolve");
  }
}

function spawnedPhraseOf(spawned: number, count: number): string {
  return `spawned ${spawned} of its ${count} reviewer subagents`;
}

function resolvePromptInputOf(ticketRun: TicketRun): ResolvePromptInput {
  const { state } = ticketRun;
  return {
    ...ticketSteps.promptFieldsOf(ticketRun),
    findings: state.findings ?? [],
    dismissedOverlaps: state.dismissedOverlaps ?? [],
  };
}

function resolveOutcomeOf({
  ranStep: { result, logPath },
  findings,
  rules,
}: ResolveRun): ResolveOutcome {
  if (result.hasCrossedCeiling) {
    return { kind: "crossed", logPath, sessionId: result.sessionId };
  }
  if (ticketSteps.isTurnCapped(result)) return { kind: "capped", logPath };
  const record = ticketSteps.recordOf("resolve", result, logPath);
  const records = rules.withReviewerFields(rules.recordsOf(record), findings);
  return { kind: "done", records, logPath };
}

function isHalt({ verdict }: ResolveRecord): boolean {
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

// A step the implementer ran after implement moves its peak and session on; a session that started takes up the pending handoff.
function noteImplementerResult(
  state: TicketState,
  { peakContext, sessionId }: StepResult,
): void {
  state.implementPeak = peakContext ?? state.implementPeak;
  if (sessionId === undefined) return;
  state.implementerSession = sessionId;
  state.latestHandoff = undefined;
}
