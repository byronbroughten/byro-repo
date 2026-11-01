// A progress log's lines and what the Run board reads from them: the current ticket, the account and the latest line.
// runBoard.ts builds one per member; progressLines.ts words and parses each line, and SpecRun/SpecRunBase.ts appends them.

import { existsSync, readFileSync } from "node:fs";

import type { UsageReading } from "./AgentStep.ts";
import { readingLabelOf } from "./limitGuard.ts";
import type { StampedLine } from "./localTime.ts";
import {
  isLimitWaitLine,
  isStepBoundaryLine,
  stampedLineOf,
  stepLaunchOfLine,
  ticketOfLine,
} from "./progressLines.ts";
import { runStateOf } from "./savedFormats.ts";
import { StepStream } from "./StepStream.ts";

export class ProgressLog {
  private readonly lines: StampedLine[];

  constructor(lines: StampedLine[]) {
    this.lines = lines;
  }

  // No lines while the log isn't written yet.
  static at(path: string): ProgressLog {
    if (!existsSync(path)) return new ProgressLog([]);
    const lines = readFileSync(path, "utf8")
      .split("\n")
      .filter((line) => line !== "")
      .map(stampedLineOf);
    return new ProgressLog(lines);
  }

  // When the latest ticket or launch line was written; 0 with none.
  get ticketTime(): number {
    return this._latestTicketLine()?.time.getTime() ?? 0;
  }

  // The current ticket is the one the latest ticket line names; its step started at its latest launch or step end.
  ticketText(statePath: string, now: Date): string {
    const latest = this._latestTicketLine();
    if (latest === undefined) return "none yet";
    const ticket = ticketOfLine(latest.text);
    if (ticket === undefined) {
      const subject = stepLaunchOfLine(latest.text)?.subject;
      return `none; ${subject}, ${durationOf(latest.time, now)} on this step`;
    }
    const step = stepOf(statePath, ticket) ?? "step unknown";
    const stepStart = this.lines.findLast(({ text }) =>
      isStepBoundaryLine(text, ticket),
    );
    if (stepStart === undefined) return `${ticket}, ${step}`;
    return `${ticket}, ${step}, ${durationOf(stepStart.time, now)} on this step`;
  }

  // A Limit wait newer than the last launch is the account's state until the next launch.
  get accountText(): string {
    const latest = this.lines.findLast(
      ({ text }) => isLimitWaitLine(text) || stepLaunchOfLine(text),
    );
    if (latest === undefined) return "none launched yet";
    const launch = stepLaunchOfLine(latest.text);
    if (launch === undefined) return latest.text;
    return readingLabelOf(launch.account, streamUsageOf(launch.streamPath));
  }

  latestText(now: Date): string {
    const latest = this.lines.at(-1);
    if (latest === undefined) return "Latest: none";
    return `Latest (${durationOf(latest.time, now)} ago): ${latest.text}`;
  }

  private _latestTicketLine(): StampedLine | undefined {
    return this.lines.findLast(
      ({ text }) => ticketOfLine(text) !== undefined || stepLaunchOfLine(text),
    );
  }
}

function stepOf(statePath: string, ticket: string): string | undefined {
  if (!existsSync(statePath)) return undefined;
  const state = runStateOf(JSON.parse(readFileSync(statePath, "utf8")));
  return state.tickets[ticket]?.step;
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
