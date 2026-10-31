// The two waits on a spec's event file: the launcher's for its run to start, and the Supervisor's watch, which also notices a vanished run.
// A vanished run can't report itself, so the watch, not the runner, reads the run lock's liveness.
// launchWait.ts is tmux.sh's command for the first; run.ts's `watch` verb runs the second, and `watch --once` its one-line form, one per spec.
import {
  type EventLine,
  rawEventLinesOf,
} from "@byronbroughten/spec-runner/EventFileNotices";
import type { IssueRef } from "@byronbroughten/spec-runner/IssueWorkspaces";
import { rerunCommandOf } from "@byronbroughten/spec-runner/SpecRun";
import type { SupervisionRecords } from "@byronbroughten/spec-runner/SupervisionRecords";

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
  spec: IssueRef;
}

export interface WatchDeps extends StartWaitDeps {
  pollMs: number;
  isRunLive: () => boolean;
  print: (line: string) => void;
}

interface OnceWatchDeps extends WatchDeps {
  records: SupervisionRecords;
  // The watch's own process, which the spec's record names as its one watch.
  pid: number;
}

interface WatchMode {
  // Prints what it takes of the lines new since the last check, and says whether the watch is done.
  printNew: (newLines: string[]) => boolean;
  isReplaced: () => boolean;
}

// tmux.sh names the session the same way.
export function tmuxSessionOf({ repo, number }: IssueRef): string {
  return `runner-${repo}-${number}`;
}

// The first run-started or run-ended line no older than the launch, so an earlier run's end is never taken for this one's.
export async function awaitRunStart(
  spec: IssueRef,
  { launchedAt, timeoutMs, pollMs }: StartWaitOptions,
  { stateFolder, now, sleep }: StartWaitDeps,
): Promise<RunStart> {
  const deadline = launchedAt.getTime() + timeoutMs;
  for (;;) {
    const line = rawEventLinesOf(stateFolder, spec).find((raw) => {
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
  spec: IssueRef,
  start: RunStart,
  { timeoutMs }: Pick<StartWaitOptions, "timeoutMs">,
): { text: string; exitCode: number } {
  if (start.kind === "unknown") {
    return {
      text: `The run's state is unknown: no run-started or run-ended line after ${timeoutMs / 1_000}s; read its pane with: tmux attach -t ${tmuxSessionOf(spec)}`,
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
  const printedCount = rawEventLinesOf(deps.stateFolder, watched.spec).length;
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
  watched: WatchedRun,
  deps: OnceWatchDeps,
): Promise<void> {
  const { records, pid } = deps;
  const start = await records.watch(watched.spec, pid);
  if (start === undefined) {
    throw new Error(
      `Nobody supervises ${specLabelOf(watched.spec)}: run supervise before watch --once.`,
    );
  }
  await watchFrom(start.offset, watched, deps, {
    printNew([firstLine]) {
      if (firstLine === undefined) return false;
      deps.print(firstLine);
      return true;
    },
    isReplaced: () => !records.isWatchedBy(watched.spec, start.watchProcess),
  });
}

async function watchFrom(
  printedFrom: number,
  { owner, spec }: WatchedRun,
  deps: WatchDeps,
  { printNew, isReplaced }: WatchMode,
): Promise<void> {
  const { stateFolder, pollMs, isRunLive, print, sleep } = deps;
  let printedCount = printedFrom;
  let isDeadOnLastCheck = false;
  for (;;) {
    if (isReplaced()) return;
    const lines = rawEventLinesOf(stateFolder, spec);
    if (printNew(lines.slice(printedCount))) return;
    printedCount = lines.length;
    const isDead = !isRunLive();
    // An earlier run's end counts only once no process holds the lock, since a relaunch may not have started yet.
    if (isDead && lastBoundaryOf(lines) === "run-ended") return;
    if (isDead && isDeadOnLastCheck) {
      print(vanishedLineOf({ owner, spec }, deps.now()));
      return;
    }
    isDeadOnLastCheck = isDead;
    await sleep(pollMs);
  }
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

// Shaped as an event line, so the Supervisor reads it as one, though no file holds it.
function vanishedLineOf({ owner, spec }: WatchedRun, time: Date): string {
  const session = tmuxSessionOf(spec);
  return JSON.stringify({
    time: time.toISOString(),
    spec: specLabelOf(spec),
    kind: "vanished",
    summary: `The runner's process is gone and wrote no run-ended line; read its tmux pane with \`tmux attach -t ${session}\`, then rerun \`${rerunCommandOf(owner, spec)}\`.`,
  });
}
