import { appendFileSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { eventFilePathOf } from "@byronbroughten/spec-runner/EventFileNotices";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { awaitRunStart, launchReportOf, watchRun } from "./runWatch.ts";

const spec = { repo: "byro-repo", number: 412 };
const launchedAt = new Date("2026-10-25T10:00:00.000Z");

let stateFolder: string;

beforeEach(() => {
  stateFolder = mkdtempSync(join(tmpdir(), "run-watch-"));
});

afterEach(() => {
  rmSync(stateFolder, { recursive: true, force: true });
});

function lineOf(kind: string, time: Date, ending?: string): string {
  return JSON.stringify({
    time: time.toISOString(),
    spec: "byro-repo#412",
    kind,
    ...(ending && { ending }),
    summary: `A ${kind} line.`,
    commentUrl: "https://github.com/byronbroughten/byro-repo/issues/412",
  });
}

function write(line: string): void {
  appendFileSync(eventFilePathOf(stateFolder, spec), `${line}\n`);
}

function at(ms: number): Date {
  return new Date(launchedAt.getTime() + ms);
}

// Its sleep advances the time, then runs each action scheduled up to the new time.
function fakeClock(scheduled: Array<{ atMs: number; run: () => void }> = []) {
  let elapsedMs = 0;
  return {
    now: () => at(elapsedMs),
    async sleep(ms: number) {
      elapsedMs += ms;
      const due = scheduled.filter(({ atMs }) => atMs <= elapsedMs);
      due.forEach((action) => {
        action.run();
        scheduled.splice(scheduled.indexOf(action), 1);
      });
    },
  };
}

describe("the launcher's wait", () => {
  const options = { launchedAt, timeoutMs: 60_000, pollMs: 1_000 };

  it("returns the run-started line written after the launch, skipping an older run's end", async () => {
    write(lineOf("run-ended", at(-60_000), "stopped"));
    const started = lineOf("run-started", at(3_000));
    const clock = fakeClock([{ atMs: 3_000, run: () => write(started) }]);

    const result = await awaitRunStart(spec, options, {
      stateFolder,
      ...clock,
    });

    expect(launchReportOf(spec, result, options)).toEqual({
      text: started,
      exitCode: 0,
    });
  });

  it("returns a run-ended line written after the launch", async () => {
    const ended = lineOf("run-ended", at(2_000), "stopped");
    const clock = fakeClock([{ atMs: 2_000, run: () => write(ended) }]);

    const result = await awaitRunStart(spec, options, {
      stateFolder,
      ...clock,
    });

    expect(launchReportOf(spec, result, options)).toEqual({
      text: ended,
      exitCode: 1,
    });
  });

  it("reports unknown once the wait runs out", async () => {
    const clock = fakeClock();

    const result = await awaitRunStart(spec, options, {
      stateFolder,
      ...clock,
    });

    expect(launchReportOf(spec, result, options)).toEqual({
      text: "The run's state is unknown: no run-started or run-ended line after 60s; read its pane with: tmux attach -t runner-byro-repo-412",
      exitCode: 1,
    });
    expect(clock.now()).toEqual(at(60_000));
  });
});

describe("watchRun", () => {
  const pollMs = 3_000;

  it("prints one vanished line when the run's process is gone with no run-ended line", async () => {
    write(lineOf("run-started", at(-5_000)));
    const printed: string[] = [];

    await watchRun(
      { owner: "byronbroughten", spec },
      {
        stateFolder,
        ...fakeClock(),
        pollMs,
        isRunLive: () => false,
        print: (line) => printed.push(line),
      },
    );

    expect(printed.map((line) => JSON.parse(line))).toEqual([
      expect.objectContaining({ spec: "byro-repo#412", kind: "vanished" }),
    ]);
  });

  it("prints only new lines while the run lives, and returns after its run-ended line", async () => {
    write(lineOf("run-started", at(-5_000)));
    const halt = lineOf("halt", at(4_000));
    const ended = lineOf("run-ended", at(7_000), "finished");
    let isLive = true;
    const printed: string[] = [];
    const clock = fakeClock([
      { atMs: 4_000, run: () => write(halt) },
      {
        atMs: 7_000,
        run: () => {
          isLive = false;
          write(ended);
        },
      },
    ]);

    await watchRun(
      { owner: "byronbroughten", spec },
      {
        stateFolder,
        ...clock,
        pollMs,
        isRunLive: () => isLive,
        print: (line) => printed.push(line),
      },
    );

    expect(printed).toEqual([halt, ended]);
  });

  it("checks a dead run once more before calling it vanished, so a crash's own line wins", async () => {
    write(lineOf("run-started", at(-5_000)));
    const crashed = lineOf("run-ended", at(1_000), "crashed");
    const printed: string[] = [];
    const clock = fakeClock([{ atMs: 1_000, run: () => write(crashed) }]);

    await watchRun(
      { owner: "byronbroughten", spec },
      {
        stateFolder,
        ...clock,
        pollMs,
        isRunLive: () => false,
        print: (line) => printed.push(line),
      },
    );

    expect(printed).toEqual([crashed]);
  });
});
