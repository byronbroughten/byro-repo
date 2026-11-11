// A spec run's agent step launches: waits out the limit guard before each, runs every step on the Active account, a resume
// included, with its guidance and the run's knobs, logs its raw stream, and retries a crash, resuming its session when it has one.
// A step a limit cuts off waits out the limit, then resumes its session on whatever account is Active; that resume is no crash retry.
// A resolver's resume that finds no conversation goes back to its caller, which reruns it as a fresh session.
// An implement step that hits its turn cap halts, offering more turns or a stronger pair; other crashes past their retries halt too.
// It builds its own HaltRaiser, and every collaborator that launches a step builds a StepLauncher.
// Steps run through ../AgentStep.ts; limit decisions are ../limitGuard.ts; the coordinator callers build is ../SpecRun.ts.

import { existsSync, mkdirSync } from "node:fs";
import { join } from "node:path";

import type { StepRequest, StepResult } from "../AgentStep.ts";
import { messageOf } from "../failureText.ts";
import { guidanceSectionOf } from "../halts.ts";
import { issueRef } from "../IssueWorkspaces.ts";
import { nextStrongerPairOf, pairLabelOf } from "../modelFit.ts";
import { stepLaunchLineOf } from "../progressLines.ts";
import { unattendedRunLine } from "../promptText.ts";
import type { RunKnobs } from "../runKnobs.ts";
import {
  handoffOnlyPrompt,
  limitResumePrompt,
  treeResetNote,
} from "../stepPrompts/resumePrompts.ts";
import { minutesOf, type StepAgent } from "../transcriptFacts.ts";
import { UnhandledStop } from "../UnhandledStop.ts";
import { HaltRaiser } from "./HaltRaiser.ts";
import {
  type Crash,
  type RanStep,
  type Run,
  type SpecStepRequest,
  type StepLaunch,
  type TicketRun,
  type TicketState,
} from "./runState.ts";
import { ticketSteps } from "./runState/ticketSteps.ts";
import { SpecRunBase } from "./SpecRunBase.ts";
import { LimitWaiter } from "./StepLauncher/LimitWaiter.ts";

type LoggedStepRequest = StepRequest & { logPath: string };

// An adapter that throws leaves the step unrun, which is retried as a crash.
type StepAttempt =
  { kind: "ran"; result: StepResult } | { kind: "unrun"; detail: string };

export class StepLauncher extends SpecRunBase {
  private get limitWaiter(): LimitWaiter {
    return new LimitWaiter(this.config);
  }

  private get haltRaiser(): HaltRaiser {
    return new HaltRaiser(this.config);
  }

  // A guidance answer goes to the halted step's next launch only, its crash retries included.
  async _runStep(
    ticketRun: TicketRun,
    agent: StepAgent,
    launch: StepLaunch,
  ): Promise<RanStep> {
    const { state } = ticketRun;
    const ran = await this._retryStep(
      ticketRun,
      agent,
      guidedLaunchOf(launch, state.guidance),
    );
    state.guidance = undefined;
    return ran;
  }

  // Retries a crash, resuming its session when it has one; leaves the result unread, so a resolver can check for a live-ceiling kill before recordOf().
  private async _retryStep(
    ticketRun: TicketRun,
    agent: StepAgent,
    launch: StepLaunch,
  ): Promise<RanStep> {
    let attempt = launch;
    let isCrashResume = false;
    for (;;) {
      const logPath = this._stepLogPathOf(ticketRun, agent);
      const ran = await this._attemptStep(ticketRun, agent, attempt, logPath);
      if (ran.kind === "unrun") {
        await this._takeCrashBeforeRetry(
          ticketRun,
          { detail: ran.detail, logPath },
          launch,
        );
        attempt = launch;
        isCrashResume = false;
        continue;
      }
      const { result } = ran;
      if (isCutOffByLimit(result)) {
        await this.limitWaiter._waitOutLimitHit(ticketRun.run, result, logPath);
        ticketRun.state.limitResumes += 1;
        this._saveState(ticketRun.run);
        attempt = limitResumeOf(launch, result);
        isCrashResume = false;
        continue;
      }
      // A resolver's caller reruns it as a fresh session; a crash resume's missing conversation stays a crash.
      if (agent === "resolve" && !isCrashResume && result.hasNoConversation) {
        return { result, logPath };
      }
      if (ticketSteps.isTurnCapped(result)) {
        // A resolver's caller resets what it left before taking the crash.
        if (agent === "resolve") return { result, logPath };
        const turns = attempt.maxTurns ?? this.config.knobs.maxTurns[agent];
        const cap = {
          detail: ticketSteps.turnCapDetailOf(agent, turns),
          logPath,
        };
        if (agent === "implement") {
          return this._haltOnImplementCap(ticketRun, cap);
        }
        await this._takeCrashBeforeRetry(ticketRun, cap, launch);
        attempt = launch;
        isCrashResume = false;
        continue;
      }
      const detail = crashDetailOf(agent, result, this.config.knobs);
      if (detail === undefined) return { result, logPath };
      await this._takeCrashBeforeRetry(ticketRun, { detail, logPath }, launch);
      isCrashResume = result.sessionId !== undefined;
      if (result.sessionId === undefined) {
        attempt = launch;
      } else {
        attempt = {
          ...launch,
          prompt: retryPromptOf(launch, ticketRun.state),
          resumeSessionId: result.sessionId,
        };
      }
    }
  }

  private async _takeCrashBeforeRetry(
    ticketRun: TicketRun,
    crash: Crash,
    launch: StepLaunch,
  ): Promise<void> {
    await this.haltRaiser._takeCrash(ticketRun, crash);
    await launch.beforeCrashRetry?.();
  }

  // Skips a path already taken, so a crashed step's log survives its retry.
  private _stepLogPathOf(ticketRun: TicketRun, agent: StepAgent): string {
    const folder = this._stepsFolderOf(ticketRun.run);
    const stem = issueRef.fileStemOf(ticketRun.ticket.issue);
    let index = ticketRun.state.sessions.length + 1;
    // Not shared with git.ts's freeBranchNameOf, which asks git asynchronously and numbers from 2.
    while (existsSync(join(folder, `${stem}-${index}-${agent}.jsonl`))) {
      index += 1;
    }
    return join(folder, `${stem}-${index}-${agent}.jsonl`);
  }

  // Offers more turns, or a stronger pair while there is one.
  private async _haltOnImplementCap(
    ticketRun: TicketRun,
    cap: Crash,
  ): Promise<never> {
    const { pair, state } = ticketRun;
    await this._snapshot(ticketRun, state.step);
    const options = [`\`resume +${this.config.knobs.extraTurns} turns\``];
    const stronger = nextStrongerPairOf(pair);
    if (stronger !== undefined) {
      options.push(`\`rerun on ${pairLabelOf(stronger)}\``);
    }
    return this.haltRaiser._failureHalt(ticketRun, {
      ...cap,
      step: state.step,
      options,
    });
  }

  private async _attemptStep(
    ticketRun: TicketRun,
    agent: StepAgent,
    { prompt, jsonSchema, beforeCrashRetry: _, ...overrides }: StepLaunch,
    logPath: string,
  ): Promise<StepAttempt> {
    const { run, ticket, pair, workspace, state, targets } = ticketRun;
    const { knobs } = this.config;
    const account = await this.limitWaiter._waitForLaunch(run);
    this._log(
      run,
      stepLaunchLineOf({
        subject: `${issueRef.labelOf(ticket.issue)}: ${agent}`,
        account,
        streamPath: logPath,
      }),
    );
    let result: StepResult;
    try {
      result = await this.config.agentStep.run({
        prompt,
        pair,
        account,
        cwd: workspace.path,
        gateRoot: this.config.primaryRoot,
        maxTurns: knobs.maxTurns[agent],
        silenceTimeoutMs: knobs.silenceTimeoutMs,
        wallClockMs: knobs.wallClockMs[agent],
        targets,
        jsonSchema,
        logPath,
        ...overrides,
      });
    } catch (error) {
      return { kind: "unrun", detail: unrunDetailOf(agent, error) };
    }
    if (result.sessionId !== undefined) {
      state.sessions.push({
        agent,
        sessionId: result.sessionId,
        account: result.account,
        configFolder: this.config.configFolder,
      });
    }
    this._saveState(run);
    keepStreamUsage(run, result);
    return { kind: "ran", result };
  }

  // Unretried: a step that belongs to the spec rather than a ticket, as the gap check does, handles its own turn cap.
  async _runSpecStep(
    run: Run,
    step: string,
    request: SpecStepRequest,
  ): Promise<RanStep> {
    const logPath = join(
      this._stepsFolderOf(run),
      `${step.replaceAll(" ", "-")}.jsonl`,
    );
    let attempt = request;
    for (;;) {
      const account = await this.limitWaiter._waitForLaunch(run);
      this._log(
        run,
        stepLaunchLineOf({
          subject: sentenceCaseOf(step),
          account,
          streamPath: logPath,
        }),
      );
      const result = await this._agentResultOf(step, {
        ...attempt,
        account,
        logPath,
      });
      keepStreamUsage(run, result);
      if (!isCutOffByLimit(result)) return { result, logPath };
      await this.limitWaiter._waitOutLimitHit(run, result, logPath);
      attempt = limitResumeOf(request, result);
    }
  }

  private async _agentResultOf(
    step: string,
    request: LoggedStepRequest,
  ): Promise<StepResult> {
    try {
      return await this.config.agentStep.run(request);
    } catch (error) {
      throw new UnhandledStop(
        "step-error",
        unrunDetailOf(step, error),
        request.logPath,
      );
    }
  }

  private _stepsFolderOf(run: Run): string {
    const folder = join(
      this.config.stateFolder,
      `${issueRef.fileStemOf(run.spec.issue)}-steps`,
    );
    mkdirSync(folder, { recursive: true });
    return folder;
  }
}

// A step that met a limit and still succeeded, as after a retry, lands as it is.
function isCutOffByLimit({
  limitHit,
  exitSubtype,
  output,
}: StepResult): boolean {
  if (limitHit === undefined) return false;
  return !(exitSubtype === "success" && output.status === "valid");
}

function keepStreamUsage(run: Run, { usage, account }: StepResult): void {
  if (usage !== undefined) run.streamUsage.set(account, usage);
}

// A step with no session id relaunches fresh, as a crash retry with none does; a backstop resume still owes only its handoff record.
function limitResumeOf<
  LR extends Pick<StepRequest, "prompt" | "resumeSessionId">,
>(launch: LR, { sessionId }: StepResult): LR {
  if (sessionId === undefined) return launch;
  let prompt = limitResumePrompt;
  if (launch.prompt === handoffOnlyPrompt) prompt = handoffOnlyPrompt;
  return { ...launch, prompt, resumeSessionId: sessionId };
}

function guidedLaunchOf(
  launch: StepLaunch,
  guidance: string | undefined,
): StepLaunch {
  if (guidance === undefined) return launch;
  return {
    ...launch,
    prompt: `${launch.prompt}\n\n${guidanceSectionOf(guidance)}`,
  };
}

// Undefined for an outcome a caller handles: a live-ceiling kill, a schema failure, success or a turn cap.
function crashDetailOf(
  agent: StepAgent,
  result: StepResult,
  knobs: RunKnobs,
): string | undefined {
  const { hang, errorText, exitSubtype, output } = result;
  if (result.hasCrossedCeiling) return undefined;
  if (hang === "silence") {
    return `The ${agent} step was silent for ${minutesOf(knobs.silenceTimeoutMs)} minutes and was killed.`;
  }
  if (hang === "wall-clock") {
    return `The ${agent} step ran past its ${minutesOf(knobs.wallClockMs[agent])}-minute wall clock and was killed.`;
  }
  if (output.status === "schemaFailure") return undefined;
  if (errorText !== undefined) {
    return `The ${agent} step ended on an error: ${errorText}`;
  }
  if (exitSubtype === undefined) {
    return `The ${agent} step ended without a result.`;
  }
  if (exitSubtype === "error_during_execution") {
    return `The ${agent} step ended ${exitSubtype}.`;
  }
  return undefined;
}

// A crashed backstop resume still owes only its handoff record.
function retryPromptOf(launch: StepLaunch, state: TicketState): string {
  if (launch.prompt === handoffOnlyPrompt) return handoffOnlyPrompt;
  return interruptedPromptOf(state);
}

function interruptedPromptOf(state: TicketState): string {
  let setAside = "";
  if (ticketSteps.isSnapshotted(state.step) && !ticketSteps.isTreeKept(state)) {
    setAside = ` ${treeResetNote}`;
  }
  return `The previous run was interrupted; continue.${setAside} ${unattendedRunLine()}`;
}

function unrunDetailOf(step: string, error: unknown): string {
  return `The ${step} step failed to run: ${messageOf(error)}`;
}

function sentenceCaseOf(text: string): string {
  return `${text.charAt(0).toUpperCase()}${text.slice(1)}`;
}
