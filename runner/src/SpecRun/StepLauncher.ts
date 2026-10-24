// A spec run's agent step launches: waits out the limit guard before each, runs a fresh step on the Active account and a
// resume on its session's recorded one, with its guidance and the run's knobs, logs its raw stream, and retries a crash, resuming its session when it has one; a hit limit is an UnhandledStop.
// An implement step that hits its turn cap halts, offering more turns or a stronger pair; other crashes past their retries halt too.
// It builds its own HaltRaiser, and every collaborator that launches a step builds a StepLauncher.
// Steps run through ../AgentStep.ts; limit decisions are ../limitGuard.ts; the coordinator callers build is ../SpecRun.ts.

import { copyFileSync, existsSync, mkdirSync } from "node:fs";
import { join } from "node:path";

import type { StepRequest, StepResult } from "../AgentStep.ts";
import { messageOf } from "../failureText.ts";
import { guidanceSectionOf } from "../halts.ts";
import { handoffOnlyPrompt, treeResetNote } from "../implementStep.ts";
import { fileStemOf, issueLabelOf } from "../IssueWorkspaces.ts";
import { decideStep, defaultLimitGuardKnobs } from "../limitGuard.ts";
import { nextStrongerPairOf, pairLabelOf } from "../modelFit.ts";
import type { RunKnobs } from "../runKnobs.ts";
import { RunStop } from "../RunStop.ts";
import { minutesOf, percentOf, type StepAgent } from "../transcriptFacts.ts";
import { UnhandledStop } from "../UnhandledStop.ts";
import { HaltRaiser } from "./HaltRaiser.ts";
import {
  type Crash,
  isSnapshotted,
  isTreeKept,
  isTurnCapped,
  type RanStep,
  type Run,
  type RunWarning,
  type StepLaunch,
  type TicketRun,
  type TicketState,
  turnCapDetailOf,
} from "./runState.ts";
import { SpecRunBase } from "./SpecRunBase.ts";

type LoggedStepRequest = StepRequest & { logPath: string };

// An adapter that throws leaves the step unrun, which is retried as a crash.
type StepAttempt =
  { kind: "ran"; result: StepResult } | { kind: "unrun"; detail: string };

export class StepLauncher extends SpecRunBase {
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
    for (;;) {
      const logPath = this._stepLogPathOf(ticketRun, agent);
      const ran = await this._attemptStep(ticketRun, agent, attempt, logPath);
      if (ran.kind === "unrun") {
        await this.haltRaiser._takeCrash(ticketRun, {
          detail: ran.detail,
          logPath,
        });
        attempt = launch;
        continue;
      }
      const { result } = ran;
      if (isTurnCapped(result)) {
        // A resolver's caller resets what it left before taking the crash.
        if (agent === "resolve") return { result, logPath };
        const turns = attempt.maxTurns ?? this.config.knobs.maxTurns[agent];
        const cap = { detail: turnCapDetailOf(agent, turns), logPath };
        if (agent === "implement") {
          return this._haltOnImplementCap(ticketRun, cap);
        }
        await this.haltRaiser._takeCrash(ticketRun, cap);
        attempt = launch;
        continue;
      }
      const detail = crashDetailOf(agent, result, this.config.knobs);
      if (detail === undefined) return { result, logPath };
      await this.haltRaiser._takeCrash(ticketRun, { detail, logPath });
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

  // Skips a path already taken, so a crashed step's log survives its retry.
  private _stepLogPathOf(ticketRun: TicketRun, agent: StepAgent): string {
    const folder = this._stepsFolderOf(ticketRun.run);
    const stem = fileStemOf(ticketRun.ticket.issue);
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
    { prompt, jsonSchema, ...overrides }: StepLaunch,
    logPath: string,
  ): Promise<StepAttempt> {
    const { run, ticket, pair, workspace, state, targets } = ticketRun;
    const { knobs } = this.config;
    const account = await this._waitForLaunch(
      run,
      resumedAccountOf(ticketRun, overrides.resumeSessionId),
    );
    this._log(
      run,
      `${issueLabelOf(ticket.issue)}: ${agent} step on account ${account}, raw stream in ${logPath}.`,
    );
    let result: StepResult;
    try {
      result = await this.config.agentStep.run({
        prompt,
        pair,
        account,
        cwd: workspace.path,
        maxTurns: knobs.maxTurns[agent],
        silenceTimeoutMs: knobs.silenceTimeoutMs,
        wallClockMs: knobs.wallClockMs[agent],
        allowedTools: knobs.allowedTools[agent],
        allowedWriteGlobs: knobs.allowedWriteGlobs,
        targets,
        jsonSchema,
        logPath,
        ...overrides,
      });
    } catch (error) {
      return { kind: "unrun", detail: unrunDetailOf(agent, error) };
    }
    state.configFolder = result.configFolder ?? state.configFolder;
    if (result.sessionId !== undefined) {
      state.sessions.push({
        agent,
        sessionId: result.sessionId,
        account: result.account,
        configFolder: state.configFolder,
      });
    }
    this._saveState(run);
    await this._stopOnLimitHit(run, result, logPath);
    return { kind: "ran", result };
  }

  // Unretried: a step that belongs to the spec rather than a ticket, as the gap check does, handles its own turn cap.
  async _runSpecStep(
    run: Run,
    step: string,
    request: Omit<StepRequest, "account">,
  ): Promise<RanStep> {
    const logPath = join(
      this._stepsFolderOf(run),
      `${step.replaceAll(" ", "-")}.jsonl`,
    );
    const account = await this._waitForLaunch(run, undefined);
    this._log(
      run,
      `${sentenceCaseOf(step)} step on account ${account}, raw stream in ${logPath}.`,
    );
    const result = await this._agentResultOf(step, {
      ...request,
      account,
      logPath,
    });
    await this._stopOnLimitHit(run, result, logPath);
    return { result, logPath };
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

  // Asks the limit guard about the account the step will run on until it says launch, and returns that account.
  private async _waitForLaunch(
    run: Run,
    recordedAccount: number | undefined,
  ): Promise<number> {
    const knobs = { ...defaultLimitGuardKnobs, ...this.config.limitGuardKnobs };
    let hasAnnouncedWait = false;
    for (;;) {
      const reading = await this._launchReadingOf(run, recordedAccount);
      const { account, usage } = reading;
      if (usage === undefined) {
        await this._warnOnce(
          run,
          "missing-reading",
          `No usage reading for account ${account}; steps launch unguarded.`,
        );
        return account;
      }
      const decision = decideStep(
        [reading],
        {
          pinnedAccount: account,
          isAtTicketBoundary: true,
          accountChangesToday: 0,
        },
        knobs,
      );
      if (decision.kind === "launch") return account;
      if (decision.kind === "stop") {
        throw new RunStop(
          `Account ${account} is at ${percentOf(usage.sevenDay.utilization)} of its weekly limit, past the reserve; rerun after it resets at ${usage.sevenDay.resetsAt.toISOString()}.`,
        );
      }
      if (decision.kind !== "limitWait") {
        throw new Error(`A one-account run can't ${decision.kind}`);
      }
      if (!hasAnnouncedWait) {
        hasAnnouncedWait = true;
        await this._announce(
          run,
          `Limit wait: account ${account} is at ${percentOf(usage.fiveHour.utilization)} of its 5-hour limit; continuing after ${decision.until.toISOString()}.`,
        );
      }
      const waitMs =
        decision.until.getTime() - this.config.clock.now().getTime();
      await this._sleep(Math.max(waitMs, knobs.limitWaitMarginMs));
    }
  }

  private async _warnOnce(
    run: Run,
    warning: RunWarning,
    summary: string,
  ): Promise<void> {
    if (run.warnings.has(warning)) return;
    run.warnings.add(warning);
    await this._announce(run, summary);
  }

  // The tree stays as is in the workspace; the first stream ever seen is kept for tightening limit detection.
  private async _stopOnLimitHit(
    run: Run,
    { limitHit, exitSubtype, output, account }: StepResult,
    logPath: string,
  ): Promise<void> {
    const hasSucceeded = exitSubtype === "success" && output.status === "valid";
    // A step that met a limit and still succeeded, as after a retry, isn't stopped.
    if (limitHit === undefined || hasSucceeded) return;
    const { window, resetsAt } = limitHit;
    const savedPath = join(this.config.stateFolder, "first-limit-hit.jsonl");
    if (!existsSync(savedPath) && existsSync(logPath)) {
      copyFileSync(logPath, savedPath);
    }
    if (resetsAt === undefined) {
      await this._warnOnce(
        run,
        "unrecognised-limit-error",
        `Unrecognised limit error on account ${account}; the saved stream can tighten detection.`,
      );
      throw new UnhandledStop(
        "limit-hit",
        "The step hit an unrecognised limit error; its reset is unknown.",
        logPath,
      );
    }
    throw new UnhandledStop(
      "limit-hit",
      `The step hit the ${window ?? "usage"} limit; it resets at ${resetsAt.toISOString()}.`,
      logPath,
    );
  }

  private _stepsFolderOf(run: Run): string {
    const folder = join(
      this.config.stateFolder,
      `${fileStemOf(run.spec.issue)}-steps`,
    );
    mkdirSync(folder, { recursive: true });
    return folder;
  }
}

// Undefined for a fresh launch; a resume's transcript lives under the account its session ran on.
function resumedAccountOf(
  { ticket, state }: TicketRun,
  resumeSessionId: string | undefined,
): number | undefined {
  if (resumeSessionId === undefined) return undefined;
  const session = state.sessions.findLast(
    ({ sessionId }) => sessionId === resumeSessionId,
  );
  if (session?.account === undefined) {
    throw new RunStop(
      `${issueLabelOf(ticket.issue)}: session ${resumeSessionId} has no recorded account to resume on.`,
      { ticket: ticket.issue },
    );
  }
  return session.account;
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
  if (isSnapshotted(state.step) && !isTreeKept(state)) {
    setAside = ` ${treeResetNote}`;
  }
  return `The previous run was interrupted; continue.${setAside} Nobody is watching this session: never ask a question or wait for an answer.`;
}

function unrunDetailOf(step: string, error: unknown): string {
  return `The ${step} step failed to run: ${messageOf(error)}`;
}

function sentenceCaseOf(text: string): string {
  return `${text.charAt(0).toUpperCase()}${text.slice(1)}`;
}
