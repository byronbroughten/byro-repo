// A ticket's steps: its sessions and heads, its turn cap, the live-ceiling phrase and snapshots, and reading a step's record,
// its schema failure and the review facts its records give.
// The TicketState these read is ../runState.ts; the Halt helpers are runHalts.ts.

import { writeFileSync } from "node:fs";

import type { StepResult } from "../../AgentStep.ts";
import { type ReviewFacts } from "../../FactsFile.ts";
import { hasUndecidedItems } from "../../reviewList.ts";
import type { RunKnobs } from "../../runKnobs.ts";
import { SchemaFailure } from "../../SchemaFailure.ts";
import { whatReviewCaughtOf } from "../../stepRecords.ts";
import { type RecordedSession, type StepAgent } from "../../transcriptFacts.ts";
import { UnhandledStop } from "../../UnhandledStop.ts";
import {
  type gapCheckLabel,
  type Heads,
  type LaunchedStep,
  type RanStep,
  type TicketRun,
  type TicketState,
  type TicketStep,
} from "../runState.ts";

export const ticketSteps = {
  isSameHeads(first: Heads, second: Heads): boolean {
    return JSON.stringify(first) === JSON.stringify(second);
  },

  // A session review has no implement record, so its workspace's branched repos stand in.
  branchedReposOf({ workspace, state }: TicketRun): string[] {
    return (
      state.record?.branches.map(({ repo }) => repo) ?? workspace.branchedRepos
    );
  },

  // Absent from a state file written before Halts, where the last implement session is the implementer's.
  implementerSessionOf(state: TicketState): string | undefined {
    return (
      state.implementerSession ?? ticketSteps.lastSessionOf(state, "implement")
    );
  },

  lastSessionOf(state: TicketState, agent: StepAgent): string | undefined {
    return state.sessions.findLast((session) => session.agent === agent)
      ?.sessionId;
  },

  // A session with no folder or account, as one saved before #367, is left out.
  recordedSessionsOf(state: TicketState): RecordedSession[] {
    return state.sessions.flatMap((session) => {
      const { account, configFolder } = session;
      if (configFolder === undefined || account === undefined) return [];
      return [{ ...session, account, configFolder }];
    });
  },

  // A live-ceiling kill is the resolver's crossing, whatever its subtype.
  isTurnCapped(result: StepResult): boolean {
    return (
      result.exitSubtype === "error_max_turns" && !result.hasCrossedCeiling
    );
  },

  turnCapDetailOf(
    step: StepAgent | typeof gapCheckLabel,
    turns: number,
  ): string {
    return `The ${step} step hit its ${turns}-turn cap.`;
  },

  // Review edits nothing, so it has no work of its own to set aside.
  isSnapshotted(step: TicketStep): boolean {
    return step !== "review";
  },

  // After a handoff the implement step builds on the uncommitted work, so a snapshot saves it without a reset.
  isTreeKept({ step, latestHandoff }: TicketState): boolean {
    const isImplement = step === "implement" || step === "resume";
    return isImplement && latestHandoff !== undefined;
  },

  // Writes the raw output beside the step's log, so the Failure Halt can link it.
  schemaFailureOf(
    logPath: string,
    { problems, output }: { problems: string[]; output: unknown },
  ): SchemaFailure {
    const outputPath = logPath.replace(/\.jsonl$/, ".output.txt");
    const raw =
      typeof output === "string"
        ? output
        : JSON.stringify(output, undefined, 2);
    writeFileSync(outputPath, raw);
    return new SchemaFailure(
      `${problems.join("; ")}\n\nRaw output: \`${outputPath}\``,
      logPath,
    );
  },

  liveCeilingPhraseOf({ liveCeiling }: RunKnobs): string {
    return `the live ceiling of ${liveCeiling}`;
  },

  launchedOf(agent: StepAgent, { result, logPath }: RanStep): LaunchedStep {
    const record = ticketSteps.recordOf(agent, result, logPath);
    const { peakContext, deniedTools } = result;
    return { record, logPath, peakContext, deniedTools };
  },

  recordOf(step: string, result: StepResult, logPath: string): unknown {
    const { output } = result;
    if (output.status === "schemaFailure") {
      throw ticketSteps.schemaFailureOf(logPath, {
        problems: output.problems,
        output: output.rawOutput,
      });
    }
    if (result.errorText !== undefined) {
      throw new UnhandledStop(
        "step-error",
        `The ${step} step ended on an error: ${result.errorText}`,
        logPath,
      );
    }
    if (result.exitSubtype !== "success" || output.status !== "valid") {
      throw new UnhandledStop(
        "step-error",
        `The ${step} step ended ${result.exitSubtype ?? "without a result"}.`,
        logPath,
      );
    }
    return output.record;
  },

  reviewFactsOf({
    resolver,
    resolveRecords = [],
    mergeMasterRecord,
    unrecordedMerge,
  }: TicketState): ReviewFacts {
    const facts: ReviewFacts = {
      reviewFixes: resolver ?? "none",
      whatReviewCaught: whatReviewCaughtOf(resolveRecords),
      proposals: resolveRecords.filter(({ verdict }) => verdict === "propose")
        .length,
    };
    const review = {
      records: resolveRecords,
      mergeMasterRecord,
      unrecordedMerge,
    };
    if (hasUndecidedItems(review)) facts.hasUndecidedReviewItems = true;
    return facts;
  },
};
