// A ticket's review and resolve steps, both the implementer's. Review records findings in the implementer's session,
// resumed once when over the inline size it skipped its reviewer subagents;
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
  type RepoCommits,
  type ResolvePromptInput,
  type ResolveRules,
  type ReviewerCheck,
  type ReviewInputsContext,
  type ReviewPromptInput,
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

// Unset reviewerCheck never sends the review back: a Workflow with none, or a diff within the inline size.
// The launch's prompt says the resumed implementer holds the ticket; freshPrompt, for a fresh session, doesn't.
interface ReviewAttempt {
  launch: StepLaunch;
  freshPrompt: string;
  reviewerCheck?: ReviewerCheck;
}

// Its freshPrompt is the review's own, which a fresh rerun of the resume takes.
interface ReviewerResume extends Required<ReviewAttempt> {
  ran: RanStep;
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

interface SkippedReviewers {
  // How the review was sent back, as the log line words it.
  sentBack: string;
  spawned: number;
  count: number;
}

// The branched repos' change from master, the review's fixed point.
interface BranchDiff extends Pick<ReviewPromptInput, "commitsSinceMaster"> {
  fileCount: number;
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
    const input: ReviewPromptInput = {
      ...(await this._reviewPromptInputOf(ticketRun)),
      pointsWorthChecking: pointsWorthCheckingOf(state.record),
    };
    const launch: StepLaunch = {
      prompt: rules.promptOf({ ...input, isTicketHeld: true }),
      jsonSchema,
      liveCeiling: this.config.knobs.liveCeiling,
    };
    const attempt: ReviewAttempt = {
      launch,
      freshPrompt: rules.promptOf(input),
      reviewerCheck: input.isInlineAllowed ? undefined : reviewerCheck,
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
    attempt: ReviewAttempt,
  ): Promise<RanStep> {
    const { launch, freshPrompt, reviewerCheck } = attempt;
    const ran = await this._runImplementerStep(ticketRun, {
      step: "review",
      launch,
      freshPrompt,
    });
    ticketRun.state.hasSkippedReviewers = undefined;
    if (reviewerCheck === undefined || ran.result.hasCrossedCeiling) return ran;
    return this._sentBackForReviewers(ticketRun, {
      ...attempt,
      ran,
      reviewerCheck,
    });
  }

  // A review that spawned fewer reviewers than its Workflow names is resumed once; a second skip is recorded for its review list.
  private async _sentBackForReviewers(
    ticketRun: TicketRun,
    { ran, reviewerCheck, launch, freshPrompt }: ReviewerResume,
  ): Promise<RanStep> {
    const { run, ticket } = ticketRun;
    const label = issueRef.labelOf(ticket.issue);
    const { count, resumePrompt } = reviewerCheck;
    const spawned = ran.result.spawnedSubagentCount;
    if (spawned >= count) return ran;
    this._log(
      run,
      `${label}: the review ${spawnedPhraseOf(spawned, count)}; resuming it to spawn them.`,
    );
    const resumed = await this._runImplementerStep(ticketRun, {
      step: "review",
      launch: {
        prompt: resumePrompt,
        jsonSchema: launch.jsonSchema,
        liveCeiling: launch.liveCeiling,
      },
      freshPrompt,
    });
    if (resumed.result.hasCrossedCeiling) return resumed;
    const total = spawned + resumed.result.spawnedSubagentCount;
    if (total < count) {
      this._markSkippedReviewers(ticketRun, {
        sentBack: "once resumed",
        spawned: total,
        count,
      });
    }
    return resumed;
  }

  // A run's review and an interactive session's alike, once sent back and still short.
  _markSkippedReviewers(
    { run, ticket, state }: TicketRun,
    { sentBack, spawned, count }: SkippedReviewers,
  ): void {
    state.hasSkippedReviewers = true;
    this._log(
      run,
      `${issueRef.labelOf(ticket.issue)}: the review, ${sentBack}, ${spawnedPhraseOf(spawned, count)}; its review list says it ran without its reviewers.`,
    );
  }

  // The prompt input a run's review and an interactive session's brief alike add to the ticket's fields.
  async _reviewPromptInputOf(ticketRun: TicketRun): Promise<ReviewPromptInput> {
    const rules = this._agentStepOf(ticketRun.run.spec, "review");
    const { fileCount, commitsSinceMaster } =
      await this._branchDiffOf(ticketRun);
    return {
      ...ticketSteps.promptFieldsOf(ticketRun),
      skillName: rules.skillName,
      isInlineAllowed:
        this._isInlineOffered(ticketRun) && this._isInlineSize(fileCount),
      commitsSinceMaster,
      suppliedInputs: await rules.suppliedInputsOf?.(
        this._reviewInputsContextOf(ticketRun),
      ),
    };
  }

  private _reviewInputsContextOf({
    run,
    ticket,
    workspace,
  }: TicketRun): ReviewInputsContext {
    const { github } = this.config;
    const others = run.tickets.filter(
      (other) => !issueRef.isSame(other, ticket.issue),
    );
    return {
      spec: run.spec,
      ticket: ticket.issue,
      workspacePath: workspace.path,
      specClone: this._cloneIn(workspace, run.spec.issue.repo),
      async commentsOnTicketsOf(isRead) {
        const bodies: string[] = [];
        for (const other of others) {
          if (!isRead(await github.issueOf(other))) continue;
          const comments = await github.authoredCommentsOf(other);
          bodies.push(...comments.map(({ body }) => body));
        }
        return bodies;
      },
    };
  }

  // Whether the review may skip its reviewer subagents, for a run's review and an interactive session's alike.
  async _isInlineAllowed(ticketRun: TicketRun): Promise<boolean> {
    if (!this._isInlineOffered(ticketRun)) return false;
    const { fileCount } = await this._branchDiffOf(ticketRun);
    return this._isInlineSize(fileCount);
  }

  private _isInlineOffered({ run }: TicketRun): boolean {
    const { reviewerCheck } = this._agentStepOf(run.spec, "review");
    return reviewerCheck?.offerInline === true;
  }

  private _isInlineSize(fileCount: number): boolean {
    return fileCount <= this.config.knobs.inlineReviewMaxFiles;
  }

  // Counted from master, the review's own fixed point, so a session with no implement base counts the same files.
  // A master that doesn't resolve fails the diff here, before the review launches.
  private async _branchDiffOf(ticketRun: TicketRun): Promise<BranchDiff> {
    let fileCount = 0;
    const repoCommits: RepoCommits[] = [];
    for (const repo of ticketSteps.branchedReposOf(ticketRun)) {
      const worktree = this._cloneIn(ticketRun.workspace, repo);
      const files = await git(worktree, "diff", "--name-only", "master...HEAD");
      const commits = await git(worktree, "log", "--oneline", "master..HEAD");
      fileCount += lines(files).length;
      repoCommits.push({ repo, commits: lines(commits) });
    }
    // Unset when no branched repo has a diff, so the review skill's own fixed-point step reports the empty diff.
    const commitsSinceMaster = fileCount === 0 ? undefined : repoCommits;
    return { fileCount, commitsSinceMaster };
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
