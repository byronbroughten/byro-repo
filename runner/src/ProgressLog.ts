// A progress log's lines and what the Run board reads from them: the current ticket, the account, its step stream reading and the latest line.
// runBoard.ts builds one per member; progressLines.ts words and parses each line, and SpecRun/SpecRunBase.ts appends them.

import { existsSync, readFileSync } from "node:fs";

import type { UsageReading } from "./AgentStep.ts";
import type { StampedLine } from "./localTime.ts";
import {
  isIdleLine,
  isStepBoundaryLine,
  stampedLineOf,
  stepLaunchOfLine,
  ticketOfLine,
} from "./progressLines.ts";
import type { RunState } from "./SpecRun/runState.ts";
import { StepStream } from "./StepStream.ts";

export interface StreamReading {
  account: number;
  usage: UsageReading;
}

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
  ticketText(state: RunState | undefined, now: Date): string {
    const latest = this._latestTicketLine();
    if (latest === undefined) return "none yet";
    const ticket = ticketOfLine(latest.text);
    if (ticket === undefined) {
      const subject = stepLaunchOfLine(latest.text)?.subject;
      return `none; ${subject}, ${durationOf(latest.time, now)} on this step`;
    }
    const step = state?.tickets[ticket]?.step ?? "step unknown";
    const number = ticketNumberOf(ticket);
    const stepStart = this.lines.findLast(({ text }) =>
      isStepBoundaryLine(text, ticket),
    );
    if (stepStart === undefined) return `${number}, ${step}`;
    return `${number}, ${step}, ${durationOf(stepStart.time, now)} on this step`;
  }

  // An Idle line newer than the last launch means the run holds no account until the next launch.
  accountText(): string {
    const latest = this._latestAccountLine();
    if (latest === undefined) return "none launched yet";
    const launch = stepLaunchOfLine(latest.text);
    if (launch === undefined) return "none; Idle, holding no account lease";
    return `${launch.account}`;
  }

  // The held account's reading from its latest step's own rate-limit events, so the board reads no account state the runs didn't write.
  streamReading(): StreamReading | undefined {
    const latest = this._latestAccountLine();
    if (latest === undefined) return undefined;
    const launch = stepLaunchOfLine(latest.text);
    if (launch === undefined) return undefined;
    const usage = streamUsageOf(launch.streamPath);
    if (usage === undefined) return undefined;
    return { account: launch.account, usage };
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

  private _latestAccountLine(): StampedLine | undefined {
    return this.lines.findLast(
      ({ text }) => isIdleLine(text) || stepLaunchOfLine(text),
    );
  }
}

// A spec's tickets are always filed in its repo, so the board drops the repo from `<repo> #<n>`.
function ticketNumberOf(ticket: string): string {
  return ticket.slice(ticket.lastIndexOf("#"));
}

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
