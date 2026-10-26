// The two waits on a spec's event file: the launcher's for its run to start, and the Supervisor's watch, which also notices a vanished run.
// A vanished run can't report itself, so the watch, not the runner, reads the run lock's liveness.
// launchWait.ts is tmux.sh's command for the first; run.ts's `watch` verb runs the second.
import {
  type EventLine,
  rawEventLinesOf,
} from "@byronbroughten/spec-runner/EventFileNotices";
import type { IssueRef } from "@byronbroughten/spec-runner/IssueWorkspaces";
import { rerunCommandOf } from "@byronbroughten/spec-runner/SpecRun";

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

interface WatchDeps extends StartWaitDeps {
  pollMs: number;
  isRunLive: () => boolean;
  print: (line: string) => void;
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

// Prints each line written after it starts and returns once the last run-ended; a run found dead on two checks in a row, with no run-ended line, is vanished.
export async function watchRun(
  { owner, spec }: WatchedRun,
  deps: WatchDeps,
): Promise<void> {
  const { stateFolder, pollMs, isRunLive, print, sleep } = deps;
  let printedCount = rawEventLinesOf(stateFolder, spec).length;
  let isDeadOnLastCheck = false;
  for (;;) {
    const lines = rawEventLinesOf(stateFolder, spec);
    lines.slice(printedCount).forEach((line) => print(line));
    printedCount = lines.length;
    if (lastBoundaryOf(lines) === "run-ended") return;
    const isDead = !isRunLive();
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

// Shaped as an event line, so the Supervisor reads it as one, though no file holds it.
function vanishedLineOf({ owner, spec }: WatchedRun, time: Date): string {
  const session = tmuxSessionOf(spec);
  return JSON.stringify({
    time: time.toISOString(),
    spec: `${spec.repo}#${spec.number}`,
    kind: "vanished",
    summary: `The runner's process is gone and wrote no run-ended line; read its tmux pane with \`tmux attach -t ${session}\`, then rerun \`${rerunCommandOf(owner, spec)}\`.`,
  });
}
