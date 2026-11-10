// The two waits on a spec's or a Batch's event file: the launcher's for its run to start, and the Supervisor's watch, which also notices a vanished run.
// A vanished run can't report itself, so the watch, not the runner, reads the run locks' liveness.
// launchWait.ts is tmux.sh's command for the first; run.ts's `watch` verb runs the second, and `watch --once` its one-line form, one per spec or Batch.
import {
  type EventLine,
  eventStreamPathOf,
  rawLinesAt,
} from "@byronbroughten/spec-runner/EventFileNotices";
import type { IssueRef } from "@byronbroughten/spec-runner/IssueWorkspaces";
import type { ProcessIdentity } from "@byronbroughten/spec-runner/processIdentity";
import { type MemberList, runText } from "@byronbroughten/spec-runner/SpecRun";
import type { SupervisionRecords } from "@byronbroughten/spec-runner/SupervisionRecords";

import { tmuxSessionOf } from "./launchArgs.ts";

interface WatchClock {
  now: () => Date;
  sleep: (ms: number) => Promise<void>;
}

interface StartWaitDeps extends WatchClock {
  stateFolder: string;
}

interface StartWaitOptions {
  launchedAt: Date;
  timeoutMs: number;
  pollMs: number;
}

type RunStart =
  { kind: "started" | "ended"; line: string } | { kind: "unknown" };

interface WatchedRun {
  owner: string;
  members: MemberList;
}

// A watch named by one member's number; the supervision record holds the Batch's list.
interface WatchedMember {
  owner: string;
  spec: IssueRef;
}

export interface WatchDeps extends StartWaitDeps {
  pollMs: number;
  isRunLive: (members: MemberList) => boolean;
  print: (line: string) => void;
}

export interface OnceWatchDeps extends WatchDeps {
  records: SupervisionRecords;
  // The watch's own process, which the spec's record names as its one watch.
  pid: number;
  // Asked by identity, so a reused pid never passes for the claude process a parked watch waits on.
  isProcessLive: (claudeProcess: ProcessIdentity) => Promise<boolean>;
}

type WatchEnd = "done" | "replaced";

const parkPollMs = 30_000;

interface WatchMode {
  // Prints what it takes of the lines new since the last check, and says whether the watch is done.
  printNew: (newLines: string[]) => boolean;
  isReplaced: () => boolean;
}

// The first run-started or run-ended line no older than the launch, so an earlier run's end is never taken for this one's.
export async function awaitRunStart(
  members: MemberList,
  { launchedAt, timeoutMs, pollMs }: StartWaitOptions,
  { stateFolder, now, sleep }: StartWaitDeps,
): Promise<RunStart> {
  const deadline = launchedAt.getTime() + timeoutMs;
  for (;;) {
    const line = linesOf(stateFolder, members).find((raw) => {
      const { time, kind } = parsedLineOf(raw);
      return isBoundary(kind) && Date.parse(time) >= launchedAt.getTime();
    });
    if (line !== undefined) {
      const isStarted = parsedLineOf(line).kind === "run-started";
      return { kind: isStarted ? "started" : "ended", line };
    }
    if (now().getTime() >= deadline) return { kind: "unknown" };
    await sleep(pollMs);
  }
}

// The launcher exits 0 only once the run has started.
export function launchReportOf(
  members: MemberList,
  start: RunStart,
  { timeoutMs }: Pick<StartWaitOptions, "timeoutMs">,
): { text: string; exitCode: number } {
  if (start.kind === "unknown") {
    return {
      text: `The run's state is unknown: no run-started or run-ended line after ${timeoutMs / 1_000}s; read its pane with: tmux attach -t ${tmuxSessionOf(members)}`,
      exitCode: 1,
    };
  }
  return { text: start.line, exitCode: start.kind === "started" ? 0 : 1 };
}

// Prints each line written after it starts and returns after a run-ended one; a run found dead on two checks in a row, with no run-ended line, is vanished.
export async function watchRun(
  watched: WatchedRun,
  deps: WatchDeps,
): Promise<void> {
  const printedCount = linesOf(deps.stateFolder, watched.members).length;
  await watchFrom(printedCount, watched, deps, {
    printNew(newLines) {
      newLines.forEach((line) => deps.print(line));
      return lastBoundaryOf(newLines) === "run-ended";
    },
    isReplaced: () => false,
  });
}

// Returns after one line; starting at the record's offset, a line written while the Supervisor explained the last still wakes it.
export async function watchOnce(
  { owner, spec }: WatchedMember,
  deps: OnceWatchDeps,
): Promise<void> {
  const { records, pid } = deps;
  const start = await records.watch(spec, pid);
  if (start === undefined) {
    throw new Error(
      `Nobody supervises ${specLabelOf(spec)}: run supervise before watch --once.`,
    );
  }
  const watched = { owner, members: start.members };
  const end = await watchFrom(start.offset, watched, deps, {
    printNew([firstLine]) {
      if (firstLine === undefined) return false;
      deps.print(firstLine);
      return true;
    },
    isReplaced: () => !records.isWatchedBy(spec, start.watchProcess),
  });
  // Claude Code hands a background command's exit to the next conversation in its process, so an exit here would wake the one after a /clear.
  if (end === "replaced") await parkUntilGone(start.supervisor, deps);
}

async function parkUntilGone(
  claudeProcess: ProcessIdentity,
  { isProcessLive, sleep }: OnceWatchDeps,
): Promise<void> {
  while (await isProcessLive(claudeProcess)) await sleep(parkPollMs);
}

async function watchFrom(
  printedFrom: number,
  watched: WatchedRun,
  deps: WatchDeps,
  { printNew, isReplaced }: WatchMode,
): Promise<WatchEnd> {
  const { stateFolder, pollMs, isRunLive, print, sleep } = deps;
  let printedCount = printedFrom;
  let isDeadOnLastCheck = false;
  for (;;) {
    if (isReplaced()) return "replaced";
    const lines = linesOf(stateFolder, watched.members);
    if (printNew(lines.slice(printedCount))) return "done";
    printedCount = lines.length;
    const isDead = !isRunLive(watched.members);
    // An earlier run's end counts only once no process holds the lock, since a relaunch may not have started yet.
    if (isDead && lastBoundaryOf(lines) === "run-ended") return "done";
    if (isDead && isDeadOnLastCheck) {
      print(vanishedLineOf(watched, deps.now()));
      return "done";
    }
    isDeadOnLastCheck = isDead;
    await sleep(pollMs);
  }
}

function linesOf(stateFolder: string, members: MemberList): string[] {
  return rawLinesAt(eventStreamPathOf(stateFolder, members));
}

function parsedLineOf(line: string): EventLine {
  return JSON.parse(line) as EventLine;
}

function isBoundary(kind: EventLine["kind"]): boolean {
  return kind === "run-started" || kind === "run-ended";
}

function lastBoundaryOf(lines: string[]): EventLine["kind"] | undefined {
  return lines
    .map((line) => parsedLineOf(line).kind)
    .filter(isBoundary)
    .at(-1);
}

function specLabelOf({ repo, number }: IssueRef): string {
  return `${repo}#${number}`;
}

// Shaped as an event line, so the Supervisor reads it as one, though no file holds it; a Batch's names its first member.
function vanishedLineOf({ owner, members }: WatchedRun, time: Date): string {
  const session = tmuxSessionOf(members);
  const [lead] = members;
  return JSON.stringify({
    time: time.toISOString(),
    spec: specLabelOf(lead),
    kind: "vanished",
    summary: `The runner's process is gone and wrote no run-ended line; read its tmux pane with \`tmux attach -t ${session}\`, then rerun \`${runText.rerunCommandOf(owner, ...members)}\`.`,
  });
}
