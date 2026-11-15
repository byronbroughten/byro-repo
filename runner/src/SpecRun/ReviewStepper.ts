// A ticket's review and resolve steps. Review records findings, resumed once when over the inline size it skipped its
// reviewer subagents; the implementer resolves them, giving each a verdict and fixing the Fix ones, carried on by a fresh
// session after a handoff; a record that breaks the rules gets one resumed retry, apart from the launcher's one schema
// resume, and a Halt verdict raises a Halt. Before review and resolve, an implementer past the ticket budget hands off.
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
import { HandoffTaker } from "./HandoffTaker.ts";
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
type ImplementerStep = "resolve" | "red-checks" | "merge-master";

// A fresh session gets freshPrompt when the resume's own prompt leans on the lost conversation.
interface ImplementerLaunch {
  step: ImplementerStep;
  launch: StepLaunch;
  freshPrompt?: string;
}

interface ReviewerResume {
  ran: RanStep;
  reviewerCheck: ReviewerCheck;
  jsonSchema: object;
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
      reviewerCheck !== undefined && (await this._isInlineSize(ticketRun));
    let ran = await this.stepLauncher._runStep(ticketRun, "review", {
      prompt: rules.promptOf({
        ...ticketSteps.promptFieldsOf(ticketRun),
        skillName: rules.skillName,
        isInlineAllowed,
        pointsWorthChecking: pointsWorthCheckingOf(state.record),
      }),
      jsonSchema,
    });
    state.hasSkippedReviewers = undefined;
    if (reviewerCheck !== undefined && !isInlineAllowed) {
      ran = await this._sentBackForReviewers(ticketRun, {
        ran,
        reviewerCheck,
        jsonSchema,
      });
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

  // A review that spawned fewer reviewers than its Workflow names is resumed once; a second skip is recorded for its review list.
  private async _sentBackForReviewers(
    ticketRun: TicketRun,
    { ran, reviewerCheck, jsonSchema }: ReviewerResume,
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
    const resumed = await this.stepLauncher._runStep(ticketRun, "review", {
      prompt: resumePrompt,
      jsonSchema,
      resumeSessionId: ran.result.sessionId,
    });
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

  // The implementer resolves; past the ticket budget it hands off first, and killed at the live ceiling it hands off and a
  // fresh session carries the resolve on. A turn cap is a crash: the work is reset away and the resolve runs again.
  // A retry ends as a first attempt would.
  async _resolve(ticketRun: TicketRun): Promise<void> {
    const { run, ticket, workspace, state } = ticketRun;
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
        this._log(
          run,
          `${issueRef.labelOf(ticket.issue)}: the implementer's resolve crossed the live ceiling; resuming it for a handoff.`,
        );
        await this.handoffTaker._handOffAtCeiling(ticketRun, attempt.sessionId);
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
      state.resolver = "implementer";
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

  // Resumes the implementer, or with a handoff pending or a resume that finds no conversation, launches a fresh session on
  // the ticket's pair, which becomes the implementer.
  async _runImplementerStep(
    ticketRun: TicketRun,
    { step, launch, freshPrompt }: ImplementerLaunch,
  ): Promise<RanStep> {
    const { run, ticket, state } = ticketRun;
    const sessionId = ticketSteps.implementerSessionOf(state);
    if (state.latestHandoff === undefined && sessionId !== undefined) {
      const ran = await this._runImplementerSession(ticketRun, {
        ...launch,
        resumeSessionId: sessionId,
      });
      if (!ran.result.hasNoConversation) return ran;
      this._log(
        run,
        `${issueRef.labelOf(ticket.issue)}: the ${step} step's session ${sessionId} has no conversation; running it as a fresh session.`,
      );
    }
    return this._runFreshImplementer(ticketRun, launch, freshPrompt);
  }

  // A pending handoff's section rides on the prompt, after the handoff cap's and a proposed split's Halts.
  private async _runFreshImplementer(
    ticketRun: TicketRun,
    launch: StepLaunch,
    freshPrompt: string | undefined,
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
    return this._runImplementerSession(ticketRun, {
      ...launch,
      prompt,
      resumeSessionId: undefined,
    });
  }

  private async _runImplementerSession(
    ticketRun: TicketRun,
    launch: StepLaunch,
  ): Promise<RanStep> {
    const ran = await this.stepLauncher._runStep(ticketRun, "resolve", launch);
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
