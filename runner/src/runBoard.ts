// The Run board: one block per run lock in the state folder, or per Batch for its members' locks, read from that spec's run state and progress log.
// It writes nothing, so it's safe beside any run; a lock whose pid is dead is marked rather than skipped.
// byro-repo's `npm run runner -- status` prints it once and `-- watch` redraws it, both with no spec.
// RunLock.ts lists the lock files, BatchRecords.ts finds a member's Batch and SpecRun/runState.ts names the run state and progress log paths.
// SpecRun/SpecRunBase.ts writes both; the progress lines the board reads are worded where the run writes them.

import { existsSync, readFileSync } from "node:fs";

import type { UsageReading } from "./AgentStep.ts";
import { BatchRecords, isMemberOf } from "./BatchRecords.ts";
import { issueLabelOf, type IssueRef } from "./IssueWorkspaces.ts";
import { readingLabelOf } from "./limitGuard.ts";
import type { StampedLine } from "./localTime.ts";
import {
  isLimitWaitLine,
  isStepBoundaryLine,
  stampedLineOf,
  stepLaunchOfLine,
  ticketOfLine,
} from "./progressLines.ts";
import { RunLock } from "./RunLock.ts";
import { runStateOf } from "./savedFormats.ts";
import {
  type MemberList,
  progressLogPathOf,
  runStatePathOf,
} from "./SpecRun/runState.ts";
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
  return new RunBoard(stateFolder).textAt(now);
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

interface MemberProgress {
  spec: IssueRef;
  lines: StampedLine[];
}

// The board over one state folder; its line readers below take only the lines.
class RunBoard {
  private readonly stateFolder: string;

  constructor(stateFolder: string) {
    this.stateFolder = stateFolder;
  }

  textAt(now: Date): string {
    const blocks = this._runs().map((members) => this._blockOf(members, now));
    if (blocks.length === 0) return boardTexts.noRuns;
    return blocks.join("\n\n");
  }

  // A Batch's members' locks make one entry, at its first-listed lock's place.
  private _runs(): MemberList[] {
    const batchRecords = BatchRecords.init(this.stateFolder);
    return RunLock.specsOf(this.stateFolder).reduce<MemberList[]>(
      (runs, spec) => {
        const isListed = runs.some((members) => isMemberOf(members, spec));
        if (!isListed) runs.push(batchRecords.membersOf(spec));
        return runs;
      },
      [],
    );
  }

  // A Batch's block reads its current member's run state and progress log.
  private _blockOf(members: MemberList, now: Date): string {
    const { spec, lines } = currentMemberOf(
      members.map((member) => this._progressOf(member)),
    );
    const isLive = RunLock.isAnyHeld(this.stateFolder, members);
    const label = runLabelOf(members);
    const statePath = runStatePathOf(this.stateFolder, spec);
    return [
      isLive ? label : `${label}: ${boardTexts.gone}`,
      ...(members.length > 1 ? [`  Member: ${issueLabelOf(spec)}`] : []),
      `  Ticket: ${ticketTextOf(statePath, lines, now)}`,
      `  Account: ${accountTextOf(lines)}`,
      `  ${latestTextOf(lines, now)}`,
    ].join("\n");
  }

  private _progressOf(spec: IssueRef): MemberProgress {
    return {
      spec,
      lines: progressLinesOf(progressLogPathOf(this.stateFolder, spec)),
    };
  }
}

// The member whose ticket or launch line is latest, or the first while none has one; a Batch is never empty.
function currentMemberOf(members: MemberProgress[]): MemberProgress {
  return members.reduce((current, member) =>
    ticketTimeOf(member) > ticketTimeOf(current) ? member : current,
  );
}

function ticketTimeOf({ lines }: MemberProgress): number {
  return latestTicketLineOf(lines)?.time.getTime() ?? 0;
}

function runLabelOf([lead, ...rest]: MemberList): string {
  if (rest.length === 0) return issueLabelOf(lead);
  const numbers = rest.map(({ number }) => `#${number}`);
  return `Batch ${[issueLabelOf(lead), ...numbers].join(", ")}`;
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
  const latest = latestTicketLineOf(lines);
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

function latestTicketLineOf(lines: StampedLine[]): StampedLine | undefined {
  return lines.findLast(
    ({ text }) => ticketOfLine(text) !== undefined || stepLaunchOfLine(text),
  );
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
