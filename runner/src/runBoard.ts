// The Run board: one block per run lock in the state folder, read from that spec's run state and progress log.
// It writes nothing, so it's safe beside any run; a lock whose pid is dead is marked rather than skipped.
// byro-repo's `npm run runner -- status` prints it once and `-- watch` redraws it, both with no spec.
// RunLock.ts names the lock files and SpecRun/SpecRunBase.ts writes the run state and progress log.

import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { issueLabelOf, type IssueRef } from "./IssueWorkspaces.ts";
import { PidLock } from "./PidLock.ts";
import { runStateOf } from "./savedFormats.ts";

interface ProgressLine {
  time: Date;
  text: string;
}

interface BoardWatch {
  render: () => string;
  draw: (board: string) => void;
  pollMs: number;
  sleep: (ms: number) => Promise<void>;
}

const lockSuffix = ".run.lock";

export function runBoardOf(stateFolder: string, now: Date): string {
  if (!existsSync(stateFolder)) return noRunsText();
  const blocks = readdirSync(stateFolder)
    .filter((name) => name.endsWith(lockSuffix))
    .sort()
    .map((name) => runBlockOf(stateFolder, name, now));
  if (blocks.length === 0) return noRunsText();
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

function noRunsText(): string {
  return "No runs are running.";
}

function runBlockOf(stateFolder: string, lockName: string, now: Date): string {
  const stem = lockName.slice(0, -lockSuffix.length);
  const spec = specOfStem(stem);
  const lines = progressLinesOf(join(stateFolder, `${stem}.log`));
  const isLive = PidLock.isHeldAt(join(stateFolder, lockName));
  return [
    isLive ? issueLabelOf(spec) : `${issueLabelOf(spec)}: ${goneText()}`,
    `  Ticket: ${ticketTextOf(join(stateFolder, `${stem}.run.json`), lines, now)}`,
    `  Account: ${accountTextOf(lines)}`,
    `  ${latestTextOf(lines, now)}`,
  ].join("\n");
}

function goneText(): string {
  return "process gone; Vanished unless its event file ends in a run-ended line";
}

// The repo may hold dashes, so only the last one splits off the number.
function specOfStem(stem: string): IssueRef {
  const dash = stem.lastIndexOf("-");
  return { repo: stem.slice(0, dash), number: Number(stem.slice(dash + 1)) };
}

function progressLinesOf(path: string): ProgressLine[] {
  if (!existsSync(path)) return [];
  return readFileSync(path, "utf8")
    .split("\n")
    .filter((line) => line !== "")
    .map((line) => {
      const space = line.indexOf(" ");
      return {
        time: new Date(line.slice(0, space)),
        text: line.slice(space + 1),
      };
    });
}

// The current ticket is the one the latest ticket line names; its step started at its latest launch or step end.
function ticketTextOf(
  statePath: string,
  lines: ProgressLine[],
  now: Date,
): string {
  const ticket = lines.flatMap(({ text }) => ticketLabelOf(text) ?? []).at(-1);
  if (ticket === undefined) return "none yet";
  const step = stepOf(statePath, ticket) ?? "step unknown";
  const stepStart = lines.findLast(({ text }) =>
    isStepBoundaryOf(text, ticket),
  );
  if (stepStart === undefined) return `${ticket}, ${step}`;
  return `${ticket}, ${step}, ${durationOf(stepStart.time, now)} on this step`;
}

function ticketLabelOf(text: string): string | undefined {
  return /^(\S+ #\d+): /.exec(text)?.[1];
}

function stepOf(statePath: string, ticket: string): string | undefined {
  if (!existsSync(statePath)) return undefined;
  const state = runStateOf(JSON.parse(readFileSync(statePath, "utf8")));
  return state.tickets[ticket]?.step;
}

function isStepBoundaryOf(text: string, ticket: string): boolean {
  if (!text.startsWith(`${ticket}: `)) return false;
  return text.includes(": launching on ") || / took \d+s\.$/.test(text);
}

// A Limit wait newer than the last launch is the account's state until the next launch.
function accountTextOf(lines: ProgressLine[]): string {
  const latest = lines.findLast(
    ({ text }) => text.startsWith("Limit wait: ") || accountOf(text),
  );
  if (latest === undefined) return "none launched yet";
  return accountOf(latest.text) ?? latest.text;
}

function accountOf(text: string): string | undefined {
  return / step on account (\d+), /.exec(text)?.[1];
}

function latestTextOf(lines: ProgressLine[], now: Date): string {
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
