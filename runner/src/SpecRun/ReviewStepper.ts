// A ticket's review and resolve steps. Review records findings; resolve gives each a verdict and fixes the Fix ones in one
// session, the resumed implementer under the ticket budget, else a fresh resolver, resetting one that crosses the live
// ceiling or whose resume finds no conversation; a refused record gets one resumed retry and a Halt verdict raises a Halt.
// Checks and landing call _runResolverStep to resume a resolver on red checks or a master merge.
// It builds its own HaltRaiser and StepLauncher; prompts are ../reviewStep.ts and ../resolveStep.ts.

import { join } from "node:path";

import type { StepRequest, StepResult } from "../AgentStep.ts";
import { git } from "../git.ts";
import { verdictHaltOf } from "../halts.ts";
import { issueLabelOf, type Workspace } from "../IssueWorkspaces.ts";
import { strongerPairOf } from "../modelFit.ts";
import {
  resolveCommitProblems,
  resolveOutputSchema,
  resolvePrompt,
  type ResolveRecord,
  resolveRecordProblems,
  resolveRecordsOf,
  resolveRetryPrompt,
  withReviewerFields,
} from "../resolveStep.ts";
import {
  type Finding,
  reviewPrompt,
  type ReviewRecord,
  reviewRecordSchema,
} from "../reviewStep.ts";
import type { StepAgent } from "../transcriptFacts.ts";
import { UnhandledStop } from "../UnhandledStop.ts";
import { HaltRaiser } from "./HaltRaiser.ts";
import {
  branchedReposOf,
  type Heads,
  implementerSessionOf,
  isSameHeads,
  isTurnCapped,
  launchedOf,
  type LaunchedStep,
  liveCeilingPhraseOf,
  raiseHalts,
  type RanStep,
  recordOf,
  type Resolver,
  schemaFailureOf,
  type StepLaunch,
  type TicketRun,
  type TicketState,
  turnCapDetailOf,
} from "./runState.ts";
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
    let resolver: Resolver = this._isUnderBudget(state)
      ? "implementer"
      : "fresh";
    let attempt = await this._runResolver(ticketRun, resolver);
    let isRetry = false;
    for (;;) {
      resolver = attempt.resolver;
      if (attempt.kind === "crossed") {
        await resetTo(workspace, base);
        if (resolver === "fresh") {
          throw new UnhandledStop(
            "step-error",
            `The fresh resolver crossed ${liveCeilingPhraseOf(this.config.knobs)}; its work is discarded.`,
            attempt.logPath,
          );
        }
        this._log(
          run,
          `${issueLabelOf(ticket.issue)}: the implementer's resolve crossed the live ceiling; handing the findings to a fresh resolver.`,
        );
        resolver = "fresh";
      } else if (attempt.kind === "capped") {
        const turns = this.config.knobs.maxTurns.resolve;
        await this.haltRaiser._takeCrash(ticketRun, {
          detail: turnCapDetailOf("resolve", turns),
          logPath: attempt.logPath,
        });
        await resetTo(workspace, base);
        resolver = this._isUnderBudget(state) ? "implementer" : "fresh";
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
          throw schemaFailureOf(logPath, { problems, output: records });
        }
        isRetry = true;
        attempt = await this._retryResolver(ticketRun, resolver, problems);
        continue;
      }
      isRetry = false;
      attempt = await this._runResolver(ticketRun, resolver);
    }
  }

  async _keepRecords(
    ticketRun: TicketRun,
    { resolver, base, records }: KeptRecords,
  ): Promise<void> {
    const { run, ticket, workspace, state } = ticketRun;
    state.resolveRecords = records;
    if (!isSameHeads(base, await this._headsOf(workspace))) {
      state.resolver = resolver;
    }
    raiseHalts(run, {
      ticket: ticket.issue,
      drafts: records.filter(isHalt).map(verdictHaltOf),
    });
  }

  async _resolveProblemsOf(
    { workspace, state }: TicketRun,
    base: Heads,
    records: ResolveRecord[],
  ): Promise<string[]> {
    const findingCount = (state.findings ?? []).length;
    const { dirtyRepos } = await this._headsAndDirtyReposOf(workspace);
    const hasChangedTree = await hasChangedTreeSince(workspace, base);
    return [
      ...resolveRecordProblems(findingCount, records),
      ...resolveCommitProblems({ records, hasChangedTree, dirtyRepos }),
    ];
  }

  // A first launch, so a fresh resolver starts a new session.
  private async _runResolver(
    ticketRun: TicketRun,
    resolver: Resolver,
  ): Promise<ResolveAttempt> {
    const prompt = resolvePromptOf(ticketRun);
    if (resolver === "fresh") {
      return this._launchResolver(ticketRun, resolver, {
        prompt,
        resumeSessionId: undefined,
      });
    }
    return this._launchResolver(ticketRun, resolver, { prompt });
  }

  // Resumes the session that returned the refused record; a fresh fallback gets the findings with the refusal.
  private async _retryResolver(
    ticketRun: TicketRun,
    resolver: Resolver,
    problems: string[],
  ): Promise<ResolveAttempt> {
    const prompt = resolveRetryPrompt(problems);
    return this._launchResolver(
      ticketRun,
      resolver,
      { prompt },
      `${resolvePromptOf(ticketRun)}\n\n${prompt}`,
    );
  }

  private async _launchResolver(
    ticketRun: TicketRun,
    resolver: Resolver,
    launch: Pick<StepLaunch, "prompt" | "resumeSessionId">,
    freshPrompt?: string,
  ): Promise<ResolveAttempt> {
    const ran = await this._runResolverStep(ticketRun, {
      step: "resolve",
      resolver,
      launch: {
        liveCeiling: this.config.knobs.liveCeiling,
        jsonSchema: resolveOutputSchema,
        ...launch,
      },
      freshPrompt,
    });
    const findings = ticketRun.state.findings ?? [];
    return { ...resolveOutcomeOf(ran, findings), resolver: ran.resolver };
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
      `${issueLabelOf(ticket.issue)}: the ${step} step's session ${resumed.resumeSessionId} has no conversation; running it as a fresh session.`,
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
      return { pair, resumeSessionId: implementerSessionOf(state) };
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
    return launchedOf(
      agent,
      await this.stepLauncher._runStep(ticketRun, agent, launch),
    );
  }
}

function resolvePromptOf(ticketRun: TicketRun): string {
  const { ticket, workspace, state } = ticketRun;
  return resolvePrompt({
    issue: ticket.issue,
    title: ticket.title,
    branch: workspace.branch,
    branchedRepos: branchedReposOf(ticketRun),
    findings: state.findings ?? [],
  });
}

function resolveOutcomeOf(
  { result, logPath }: RanStep,
  findings: Finding[],
): ResolveOutcome {
  if (result.hasCrossedCeiling) return { kind: "crossed", logPath };
  if (isTurnCapped(result)) return { kind: "capped", logPath };
  const record = recordOf("resolve", result, logPath);
  const records = withReviewerFields(resolveRecordsOf(record), findings);
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
