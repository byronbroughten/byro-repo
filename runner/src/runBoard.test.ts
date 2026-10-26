import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { hostname, tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { deadPid, seedHolder } from "./lockFixture.ts";
import { runBoardOf, watchBoard } from "./runBoard.ts";

const now = new Date("2026-10-25T12:00:00.000Z");
let stateFolder: string;

beforeEach(() => {
  stateFolder = mkdtempSync(join(tmpdir(), "run-board-"));
});

afterEach(() => {
  rmSync(stateFolder, { recursive: true, force: true });
});

interface FixtureRun {
  stem: string;
  pid: number;
  steps: Record<string, string>;
  log: string[];
}

function seedRun({ stem, pid, steps, log }: FixtureRun): void {
  seedHolder(join(stateFolder, `${stem}.run.lock`), {
    pid,
    host: hostname(),
    startedAt: "2026-10-25T11:00:00.000Z",
  });
  const tickets = Object.fromEntries(
    Object.entries(steps).map(([label, step]) => [
      label,
      { step, sessions: [] },
    ]),
  );
  writeFileSync(
    join(stateFolder, `${stem}.run.json`),
    JSON.stringify({ tickets }),
  );
  writeFileSync(join(stateFolder, `${stem}.log`), `${log.join("\n")}\n`);
}

describe("runBoardOf", () => {
  it("shows a running run's ticket, step, time on step, account and latest line", () => {
    seedRun({
      stem: "byro-repo-424",
      pid: process.pid,
      steps: { "byro-repo #430": "landed", "byro-repo #431": "review" },
      log: [
        "2026-10-25T11:00:05.000Z Preflight passed in 5s.",
        "2026-10-25T11:00:06.000Z byro-repo #431: launching on Opus medium from implement.",
        "2026-10-25T11:00:07.000Z byro-repo #431: implement step on account 2, raw stream in /s/1.jsonl.",
        "2026-10-25T11:48:30.000Z byro-repo #431: implement took 2903s.",
        "2026-10-25T11:48:31.000Z byro-repo #431: review step on account 2, raw stream in /s/2.jsonl.",
      ],
    });
    expect(runBoardOf(stateFolder, now)).toBe(
      [
        "byro-repo #424",
        "  Ticket: byro-repo #431, review, 11m 30s on this step",
        "  Account: 2",
        "  Latest (11m 29s ago): byro-repo #431: review step on account 2, raw stream in /s/2.jsonl.",
      ].join("\n"),
    );
  });

  it("shows a run in a Limit wait", () => {
    seedRun({
      stem: "byro-repo-424",
      pid: process.pid,
      steps: { "byro-repo #431": "review" },
      log: [
        "2026-10-25T11:00:06.000Z byro-repo #431: launching on Opus medium from implement.",
        "2026-10-25T11:00:07.000Z byro-repo #431: implement step on account 2, raw stream in /s/1.jsonl.",
        "2026-10-25T11:30:00.000Z byro-repo #431: implement took 1793s.",
        "2026-10-25T11:30:01.000Z Limit wait: account 2 is at 95% of its 5-hour limit; continuing after 2026-10-25T13:05:00.000Z. A switch ends it.",
      ],
    });
    expect(runBoardOf(stateFolder, now)).toBe(
      [
        "byro-repo #424",
        "  Ticket: byro-repo #431, review, 30m 0s on this step",
        "  Account: Limit wait: account 2 is at 95% of its 5-hour limit; continuing after 2026-10-25T13:05:00.000Z. A switch ends it.",
        "  Latest (29m 59s ago): Limit wait: account 2 is at 95% of its 5-hour limit; continuing after 2026-10-25T13:05:00.000Z. A switch ends it.",
      ].join("\n"),
    );
  });

  it("shows a spec-level step, such as the gap check, in place of a ticket", () => {
    seedRun({
      stem: "byro-repo-424",
      pid: process.pid,
      steps: { "byro-repo #431": "landed" },
      log: [
        "2026-10-25T11:40:00.000Z byro-repo #431: wrap-up took 30s.",
        "2026-10-25T11:50:00.000Z Gap check step on account 1, raw stream in /s/g.jsonl.",
      ],
    });
    expect(runBoardOf(stateFolder, now).split("\n")[1]).toBe(
      "  Ticket: none; Gap check, 10m 0s on this step",
    );
  });

  it("marks a run whose lock's pid is dead", () => {
    seedRun({
      stem: "personal-21",
      pid: deadPid(),
      steps: { "personal #22": "implement" },
      log: [
        "2026-10-25T10:00:00.000Z personal #22: launching on Sonnet high from implement.",
        "2026-10-25T10:00:01.000Z personal #22: implement step on account 1, raw stream in /s/3.jsonl.",
      ],
    });
    expect(runBoardOf(stateFolder, now)).toBe(
      [
        "personal #21: process gone; Vanished unless its event file ends in a run-ended line",
        "  Ticket: personal #22, implement, 2h 0m on this step",
        "  Account: 1",
        "  Latest (1h 59m ago): personal #22: implement step on account 1, raw stream in /s/3.jsonl.",
      ].join("\n"),
    );
  });

  it("shows a run still in preflight, with no run state yet", () => {
    seedHolder(join(stateFolder, "byro-repo-424.run.lock"), {
      pid: process.pid,
      host: hostname(),
      startedAt: "2026-10-25T11:59:58.000Z",
    });
    expect(runBoardOf(stateFolder, now)).toBe(
      [
        "byro-repo #424",
        "  Ticket: none yet",
        "  Account: none launched yet",
        "  Latest: none",
      ].join("\n"),
    );
  });

  it("puts one block per run, blank-line separated, and says so with none", () => {
    expect(runBoardOf(stateFolder, now)).toBe("No runs are running.");
    seedRun({ stem: "byro-repo-424", pid: process.pid, steps: {}, log: [] });
    seedRun({ stem: "personal-21", pid: process.pid, steps: {}, log: [] });
    expect(runBoardOf(stateFolder, now).split("\n\n")).toHaveLength(2);
  });

  it("says so when the state folder doesn't exist yet", () => {
    expect(runBoardOf(join(stateFolder, "missing"), now)).toBe(
      "No runs are running.",
    );
  });
});

describe("watchBoard", () => {
  it("redraws every poll until interrupted", async () => {
    const drawn: string[] = [];
    let sleeps = 0;
    const watching = watchBoard({
      render: () => `board ${drawn.length}`,
      draw: (board) => drawn.push(board),
      pollMs: 5_000,
      sleep: async (ms) => {
        expect(ms).toBe(5_000);
        sleeps += 1;
        if (sleeps === 3) throw new Error("interrupted");
      },
    });
    await expect(watching).rejects.toThrow("interrupted");
    expect(drawn).toEqual(["board 0", "board 1", "board 2"]);
  });
});
