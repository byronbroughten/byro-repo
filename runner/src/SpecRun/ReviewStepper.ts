// A ticket's review and resolve steps. Review records findings; resolve gives each a verdict and fixes the Fix ones in one
// session, the resumed implementer under the ticket budget, else a fresh resolver, resetting one that crosses the live
// ceiling or whose resume finds no conversation; a refused record gets one resumed retry and a Halt verdict raises a Halt.
// Checks and landing call _runResolverStep to resume a resolver on red checks or a master merge.
// It builds its own HaltRaiser and StepLauncher; each step's prompt, schema and checks are its spec's Workflow's, through
// ../Workflow.ts, as is whether resolve resumes the implementer and the prompt a fresh fallback gets.

import { join } from "node:path";

import type { StepRequest, StepResult } from "../AgentStep.ts";
import { git } from "../git.ts";
import { verdictHaltOf } from "../halts.ts";
import { issueRef, type Workspace } from "../IssueWorkspaces.ts";
import { strongerPairOf } from "../modelFit.ts";
import { schemaProblemsOf } from "../recordSchema.ts";
import {
  type Finding,
  type ResolveRecord,
  type ReviewRecord,
} from "../stepRecords.ts";
import type { StepAgent } from "../transcriptFacts.ts";
import { UnhandledStop } from "../UnhandledStop.ts";
import { type ResolvePromptInput, type ResolveRules } from "../Workflow.ts";
import { HaltRaiser } from "./HaltRaiser.ts";
import {
  type Heads,
  type LaunchedStep,
  type RanStep,
  type Resolver,
  type StepLaunch,
  type TicketRun,
  type TicketState,
} from "./runState.ts";
import { runHalts } from "./runState/runHalts.ts";
import { ticketSteps } from "./runState/ticketSteps.ts";
import { SpecRunBase } from "./SpecRunBase.ts";
import { StepLauncher } from "./StepLauncher.ts";

type ResolverSession = Pick<StepRequest, "pair" | "resumeSessionId">;

// Names the launch in the progress log; red checks and merge-master run as the resolve agent too.
type ResolverStep = "resolve" | "red-checks" | "merge-master";

// A fresh fallback gets freshPrompt when the resume's own prompt leans on the lost conversation.
interface ResolverLaunch {
  step: ResolverStep;
  resolver: Resolver;
  launch: StepLaunch;
  freshPrompt?: string;
}

type ResolverRan = RanStep & { resolver: Resolver };

type ResolveOutcome =
  | { kind: "done"; records: ResolveRecord[]; logPath: string }
  | { kind: "crossed"; logPath: string }
  | { kind: "capped"; logPath: string };

// Names the resolver that ran, a fresh one when the resume found no conversation.
type ResolveAttempt = ResolveOutcome & { resolver: Resolver };

interface ResolveRun {
  ranStep: RanStep;
  findings: Finding[];
  rules: ResolveRules;
}

interface KeptRecords {
  resolver: Resolver;
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

  async _review(ticketRun: TicketRun): Promise<void> {
    const { run, ticket, workspace, state } = ticketRun;
    const rules = this._agentStepOf(run.spec, "review");
    const { record, logPath } = await this._launch(ticketRun, "review", {
      prompt: rules.promptOf({
        issue: ticket.issue,
        spec: run.spec.issue,
        title: ticket.title,
        skillName: rules.skillName,
        branch: workspace.branch,
        branchedRepos: ticketSteps.branchedReposOf(ticketRun),
        workspacePath: workspace.path,
      }),
      jsonSchema: rules.outputSchema,
    });
    const problems = schemaProblemsOf(rules.outputSchema, record);
    if (problems.length > 0) {
      throw ticketSteps.schemaFailureOf(logPath, { problems, output: record });
    }
    const { findings, dismissedOverlaps } = record as ReviewRecord;
    state.findings = findings;
    state.dismissedOverlaps = dismissedOverlaps;
  }

  // The resumed implementer resolves under the ticket budget; otherwise, or once killed, a fresh resolver does.
  // A turn cap is a crash: the work is reset away and the resolve runs again. A retry ends as a first attempt would.
  async _resolve(ticketRun: TicketRun): Promise<void> {
    const { run, ticket, workspace, state } = ticketRun;
    if (state.resolveBase === undefined) {
      state.resolveBase = await this._headsOf(workspace);
      this._saveState(run);
    } else {
      await resetTo(workspace, state.resolveBase);
    }
    const base = state.resolveBase;
    let resolver = this._firstResolverOf(ticketRun);
    let attempt = await this._runResolver(ticketRun, resolver);
    let isRetry = false;
    for (;;) {
      resolver = attempt.resolver;
      if (attempt.kind === "crossed") {
        await resetTo(workspace, base);
        if (resolver === "fresh") {
          throw new UnhandledStop(
            "step-error",
            `The fresh resolver crossed ${ticketSteps.liveCeilingPhraseOf(this.config.knobs)}; its work is discarded.`,
            attempt.logPath,
          );
        }
        this._log(
          run,
          `${issueRef.labelOf(ticket.issue)}: the implementer's resolve crossed the live ceiling; handing the findings to a fresh resolver.`,
        );
        resolver = "fresh";
      } else if (attempt.kind === "capped") {
        const turns = this.config.knobs.maxTurns.resolve;
        await this.haltRaiser._takeCrash(ticketRun, {
          detail: ticketSteps.turnCapDetailOf("resolve", turns),
          logPath: attempt.logPath,
        });
        await resetTo(workspace, base);
        resolver = this._firstResolverOf(ticketRun);
      } else {
        const { records, logPath } = attempt;
        const problems = await this._resolveProblemsOf(
          ticketRun,
          base,
          records,
        );
        if (problems.length === 0) {
          await this._keepRecords(ticketRun, { resolver, base, records });
          return;
        }
        if (isRetry) {
          throw ticketSteps.schemaFailureOf(logPath, {
            problems,
            output: records,
          });
        }
        isRetry = true;
        attempt = await this._retryResolver(ticketRun, resolver, problems);
        continue;
      }
      isRetry = false;
      attempt = await this._runResolver(ticketRun, resolver);
    }
  }

  // Resolve resumes the Step its Workflow names only under the ticket budget.
  private _firstResolverOf(ticketRun: TicketRun): Resolver {
    const { resumes } = this._resolveRulesOf(ticketRun);
    if (resumes !== undefined && this._isUnderBudget(ticketRun.state)) {
      return "implementer";
    }
    return "fresh";
  }

  async _keepRecords(
    ticketRun: TicketRun,
    { resolver, base, records }: KeptRecords,
  ): Promise<void> {
    const { run, ticket, workspace, state } = ticketRun;
    state.resolveRecords = records;
    if (!ticketSteps.isSameHeads(base, await this._headsOf(workspace))) {
      state.resolver = resolver;
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

  // A first launch, so a fresh resolver starts a new session.
  private async _runResolver(
    ticketRun: TicketRun,
    resolver: Resolver,
  ): Promise<ResolveAttempt> {
    const prompt = this._resolveRulesOf(ticketRun).promptOf(
      resolvePromptInputOf(ticketRun),
    );
    if (resolver === "fresh") {
      return this._launchResolver(ticketRun, resolver, {
        prompt,
        resumeSessionId: undefined,
      });
    }
    return this._launchResolver(ticketRun, resolver, { prompt });
  }

  // Resumes the session that returned the refused record; a fresh fallback gets the prompt the Workflow's resumption gives it.
  private async _retryResolver(
    ticketRun: TicketRun,
    resolver: Resolver,
    problems: string[],
  ): Promise<ResolveAttempt> {
    const { retryPromptOf } = this._resolveRulesOf(ticketRun);
    return this._launchResolver(
      ticketRun,
      resolver,
      { prompt: retryPromptOf(problems) },
      freshRetryPromptOf(ticketRun, problems, this._resolveRulesOf(ticketRun)),
    );
  }

  private async _launchResolver(
    ticketRun: TicketRun,
    resolver: Resolver,
    launch: Pick<StepLaunch, "prompt" | "resumeSessionId">,
    freshPrompt?: string,
  ): Promise<ResolveAttempt> {
    const rules = this._resolveRulesOf(ticketRun);
    const ran = await this._runResolverStep(ticketRun, {
      step: "resolve",
      resolver,
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
      resolver: ran.resolver,
    };
  }

  // A resume that finds no conversation reruns once as a fresh resolver, which is the resolver it returns.
  async _runResolverStep(
    ticketRun: TicketRun,
    { step, resolver, launch, freshPrompt }: ResolverLaunch,
  ): Promise<ResolverRan> {
    const resumed = {
      ...this._resolverSessionOf(ticketRun, resolver),
      ...launch,
    };
    const ran = await this._runResolverSession(ticketRun, resolver, resumed);
    if (!ran.result.hasNoConversation) return { ...ran, resolver };
    const { run, ticket } = ticketRun;
    this._log(
      run,
      `${issueRef.labelOf(ticket.issue)}: the ${step} step's session ${resumed.resumeSessionId} has no conversation; running it as a fresh session.`,
    );
    const freshRan = await this._runResolverSession(ticketRun, "fresh", {
      ...this._resolverSessionOf(ticketRun, "fresh"),
      ...launch,
      prompt: freshPrompt ?? launch.prompt,
      resumeSessionId: undefined,
    });
    return { ...freshRan, resolver: "fresh" };
  }

  private async _runResolverSession(
    ticketRun: TicketRun,
    resolver: Resolver,
    launch: StepLaunch,
  ): Promise<RanStep> {
    const ran = await this.stepLauncher._runStep(ticketRun, "resolve", launch);
    const { state } = ticketRun;
    if (resolver === "implementer") noteImplementerResult(state, ran.result);
    if (resolver === "fresh") {
      state.resolverSession = ran.result.sessionId ?? state.resolverSession;
    }
    return ran;
  }

  private _resolverSessionOf(
    { pair, state }: TicketRun,
    resolver: Resolver,
  ): ResolverSession {
    if (resolver === "implementer") {
      return { pair, resumeSessionId: ticketSteps.implementerSessionOf(state) };
    }
    return {
      pair: strongerPairOf(this.config.knobs.resolverPair, pair),
      resumeSessionId: state.resolverSession,
    };
  }

  private async _launch(
    ticketRun: TicketRun,
    agent: StepAgent,
    launch: StepLaunch,
  ): Promise<LaunchedStep> {
    return ticketSteps.launchedOf(
      agent,
      await this.stepLauncher._runStep(ticketRun, agent, launch),
    );
  }

  private _resolveRulesOf({ run }: TicketRun): ResolveRules {
    return this._agentStepOf(run.spec, "resolve");
  }
}

function resolvePromptInputOf(ticketRun: TicketRun): ResolvePromptInput {
  const { run, ticket, workspace, state } = ticketRun;
  return {
    issue: ticket.issue,
    spec: run.spec.issue,
    title: ticket.title,
    branch: workspace.branch,
    branchedRepos: ticketSteps.branchedReposOf(ticketRun),
    workspacePath: workspace.path,
    findings: state.findings ?? [],
  };
}

// With no resumption every resolver starts fresh, so its fallback still needs the step's prompt beside the refusal.
function freshRetryPromptOf(
  ticketRun: TicketRun,
  problems: string[],
  { promptOf, retryPromptOf, resumes }: ResolveRules,
): string {
  const input = resolvePromptInputOf(ticketRun);
  if (resumes !== undefined) return resumes.freshRetryPromptOf(input, problems);
  return `${promptOf(input)}\n\n${retryPromptOf(problems)}`;
}

function resolveOutcomeOf({
  ranStep: { result, logPath },
  findings,
  rules,
}: ResolveRun): ResolveOutcome {
  if (result.hasCrossedCeiling) return { kind: "crossed", logPath };
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

// A resolve or red-checks step the implementer ran moves its peak and session on.
function noteImplementerResult(
  state: TicketState,
  { peakContext, sessionId }: StepResult,
): void {
  state.implementPeak = peakContext ?? state.implementPeak;
  state.implementerSession = sessionId ?? state.implementerSession;
}
