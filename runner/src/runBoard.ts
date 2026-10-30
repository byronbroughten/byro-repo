// The Run board: one block per run lock in the state folder, read from that spec's run state and progress log.
// It writes nothing, so it's safe beside any run; a lock whose pid is dead is marked rather than skipped.
// byro-repo's `npm run runner -- status` prints it once and `-- watch` redraws it, both with no spec.
// RunLock.ts lists the lock files and SpecRun/runState.ts names the run state and progress log paths.
// SpecRun/SpecRunBase.ts writes both; the progress lines the board reads are worded where the run writes them.

import { existsSync, readFileSync } from "node:fs";

import type { UsageReading } from "./AgentStep.ts";
import { issueLabelOf, type IssueRef } from "./IssueWorkspaces.ts";
import { readingLabelOf } from "./limitGuard.ts";
import {
  isLimitWaitLine,
  isStepBoundaryLine,
  type StampedLine,
  stampedLineOf,
  stepLaunchOfLine,
  ticketOfLine,
} from "./progressLines.ts";
import { RunLock } from "./RunLock.ts";
import { runStateOf } from "./savedFormats.ts";
import { progressLogPathOf, runStatePathOf } from "./SpecRun/runState.ts";
import { StepStream } from "./StepStream.ts";

interface BoardWatch {
  render: () => string;
  draw: (board: string) => void;
  pollMs: number;
  sleep: (ms: number) => Promise<void>;
}

const boardTexts = {
  noRuns: "No runs are running.",
  gone: "process gone; Vanished unless its event file ends in a run-ended line",
} as const;

export function runBoardOf(stateFolder: string, now: Date): string {
  const blocks = RunLock.specsOf(stateFolder).map((spec) =>
    runBlockOf(stateFolder, spec, now),
  );
  if (blocks.length === 0) return boardTexts.noRuns;
  return blocks.join("\n\n");
}

// Returns only by throwing, which a Ctrl-C does by ending the process instead.
export async function watchBoard({
  render,
  draw,
  pollMs,
  sleep,
}: BoardWatch): Promise<never> {
  for (;;) {
    draw(render());
    await sleep(pollMs);
  }
}

function runBlockOf(stateFolder: string, spec: IssueRef, now: Date): string {
  const lines = progressLinesOf(progressLogPathOf(stateFolder, spec));
  const isLive = RunLock.isHeld(stateFolder, spec);
  const statePath = runStatePathOf(stateFolder, spec);
  return [
    isLive ? issueLabelOf(spec) : `${issueLabelOf(spec)}: ${boardTexts.gone}`,
    `  Ticket: ${ticketTextOf(statePath, lines, now)}`,
    `  Account: ${accountTextOf(lines)}`,
    `  ${latestTextOf(lines, now)}`,
  ].join("\n");
}

function progressLinesOf(path: string): StampedLine[] {
  if (!existsSync(path)) return [];
  return readFileSync(path, "utf8")
    .split("\n")
    .filter((line) => line !== "")
    .map(stampedLineOf);
}

// The current ticket is the one the latest ticket line names; its step started at its latest launch or step end.
function ticketTextOf(
  statePath: string,
  lines: StampedLine[],
  now: Date,
): string {
  const latest = lines.findLast(
    ({ text }) => ticketOfLine(text) !== undefined || stepLaunchOfLine(text),
  );
  if (latest === undefined) return "none yet";
  const ticket = ticketOfLine(latest.text);
  if (ticket === undefined) {
    const subject = stepLaunchOfLine(latest.text)?.subject;
    return `none; ${subject}, ${durationOf(latest.time, now)} on this step`;
  }
  const step = stepOf(statePath, ticket) ?? "step unknown";
  const stepStart = lines.findLast(({ text }) =>
    isStepBoundaryLine(text, ticket),
  );
  if (stepStart === undefined) return `${ticket}, ${step}`;
  return `${ticket}, ${step}, ${durationOf(stepStart.time, now)} on this step`;
}

function stepOf(statePath: string, ticket: string): string | undefined {
  if (!existsSync(statePath)) return undefined;
  const state = runStateOf(JSON.parse(readFileSync(statePath, "utf8")));
  return state.tickets[ticket]?.step;
}

// A Limit wait newer than the last launch is the account's state until the next launch.
function accountTextOf(lines: StampedLine[]): string {
  const latest = lines.findLast(
    ({ text }) => isLimitWaitLine(text) || stepLaunchOfLine(text),
  );
  if (latest === undefined) return "none launched yet";
  const launch = stepLaunchOfLine(latest.text);
  if (launch === undefined) return latest.text;
  return readingLabelOf(launch.account, streamUsageOf(launch.streamPath));
}

// The step's own rate-limit events, so the board reads no account state the runs didn't write.
function streamUsageOf(streamPath: string): UsageReading | undefined {
  if (!existsSync(streamPath)) return undefined;
  const stream = StepStream.init();
  readFileSync(streamPath, "utf8")
    .split("\n")
    .forEach((line) => stream.observeLine(line));
  return stream.usage;
}

function latestTextOf(lines: StampedLine[], now: Date): string {
  const latest = lines.at(-1);
  if (latest === undefined) return "Latest: none";
  return `Latest (${durationOf(latest.time, now)} ago): ${latest.text}`;
}

function durationOf(since: Date, now: Date): string {
  const seconds = Math.max(
    0,
    Math.floor((now.getTime() - since.getTime()) / 1000),
  );
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  if (hours > 0) return `${hours}h ${minutes}m`;
  return `${minutes}m ${seconds % 60}s`;
}
