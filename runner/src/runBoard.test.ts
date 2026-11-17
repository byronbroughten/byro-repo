import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { hostname, tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { AccountsSection } from "./AccountsSection.ts";
import type { UsageWindow } from "./AgentStep.ts";
import { BatchRecords } from "./BatchRecords.ts";
import { FakeUsageReader } from "./FakeUsageReader.ts";
import type { UsageList } from "./limitGuard.ts";
import { deadPid, seedHolder } from "./lockFixture.ts";
import { boardTimings, runBoardOf, watchBoard } from "./runBoard.ts";

const now = new Date("2026-10-25T12:00:00.000Z");
const resetsAt = new Date("2026-10-25T14:00:00.000Z");
let stateFolder: string;

beforeEach(() => {
  stateFolder = mkdtempSync(join(tmpdir(), "run-board-"));
});

afterEach(() => {
  rmSync(stateFolder, { recursive: true, force: true });
});

function windowOf(percent: number): UsageWindow {
  return { utilization: percent / 100, resetsAt };
}

const twoAccounts: UsageList = {
  readings: [
    { account: 1, usage: { fiveHour: windowOf(10), sevenDay: windowOf(5) } },
    { account: 2, usage: { fiveHour: windowOf(40), sevenDay: windowOf(10) } },
  ],
  activeAccount: 1,
};

const accountsText = [
  "Accounts",
  "  1. (active) 5h: 10% (2h 0m), 7d: 5% (2h 0m)",
  "  2. 5h: 40% (2h 0m), 7d: 10% (2h 0m)",
].join("\n");

function accountsOf(refreshMs?: number) {
  const usageReader = FakeUsageReader.init(twoAccounts);
  const accounts = AccountsSection.init({
    usageReader,
    leaseReader: { read: () => [] },
    refreshMs,
  });
  return { accounts, usageReader };
}

function boardAt(folder = stateFolder): Promise<string> {
  return runBoardOf({
    stateFolder: folder,
    accounts: accountsOf().accounts,
    now,
  });
}

// The Runs section, above the Accounts section.
async function runsAt(folder = stateFolder): Promise<string> {
  const board = await boardAt(folder);
  const rest = board.split("\n\n");
  expect(rest.pop()).toBe(accountsText);
  return rest.join("\n\n");
}

interface FixtureRun {
  stem: string;
  pid: number;
  steps: Record<string, string>;
  log: string[];
  // Absent as an older runner wrote it.
  ticketLabels?: string[];
}

function seedRun({ stem, pid, steps, log, ticketLabels }: FixtureRun): void {
  seedHolder(join(stateFolder, `${stem}.run.lock`), {
    pid,
    host: hostname(),
    startedAt: "2026-10-25T11:00:00.000Z",
  });
  const tickets = Object.fromEntries(
    Object.entries(steps).map(([label, step]) => [
      label,
      { step, sessions: [], limitResumes: 0 },
    ]),
  );
  writeFileSync(
    join(stateFolder, `${stem}.run.json`),
    JSON.stringify({ tickets, ticketLabels }),
  );
  writeFileSync(join(stateFolder, `${stem}.log`), `${log.join("\n")}\n`);
}

interface FixtureUsage {
  fiveHour: number;
  sevenDay: number;
}

// One rate-limit event, as a step's raw stream carries it.
function seedStream(path: string, { fiveHour, sevenDay }: FixtureUsage): void {
  const resetsAtSeconds = resetsAt.getTime() / 1000;
  const event = {
    type: "rate_limit_event",
    rate_limit_info: {
      status: "allowed",
      unifiedWindows: {
        five_hour: { utilization: fiveHour, resetsAt: resetsAtSeconds },
        seven_day: { utilization: sevenDay, resetsAt: resetsAtSeconds },
      },
    },
  };
  writeFileSync(path, `${JSON.stringify(event)}\n`);
}

describe("runBoardOf", () => {
  it("shows a Runs section and then an Accounts section, with no title above them", async () => {
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
    expect(await boardAt()).toBe(
      [
        "byro-repo #424",
        "  Ticket: #431, review, 11m 30s on this step",
        "  Account: 2",
        "  Latest (11m 29s ago): byro-repo #431: review step on account 2, raw stream in /s/2.jsonl.",
        "",
        accountsText,
      ].join("\n"),
    );
  });

  it("brings a live run's step stream reading to the Accounts section for its account", async () => {
    const streamPath = join(stateFolder, "review.jsonl");
    seedStream(streamPath, { fiveHour: 0.62, sevenDay: 0.3 });
    seedRun({
      stem: "byro-repo-424",
      pid: process.pid,
      steps: { "byro-repo #431": "review" },
      log: [
        `2026-10-25T11:48:31.000Z byro-repo #431: review step on account 2, raw stream in ${streamPath}.`,
      ],
    });
    expect((await boardAt()).split("\n").at(-1)).toBe(
      "  2. 5h: 62% (2h 0m), 7d: 30% (2h 0m)",
    );
  });

  it("brings no stream reading from a run whose process is gone", async () => {
    const streamPath = join(stateFolder, "review.jsonl");
    seedStream(streamPath, { fiveHour: 0.62, sevenDay: 0.3 });
    seedRun({
      stem: "byro-repo-424",
      pid: deadPid(),
      steps: { "byro-repo #431": "review" },
      log: [
        `2026-10-25T11:48:31.000Z byro-repo #431: review step on account 2, raw stream in ${streamPath}.`,
      ],
    });
    expect((await boardAt()).endsWith(accountsText)).toBe(true);
  });

  it("shows a run's Limit wait only on its latest line", async () => {
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
    expect(await runsAt()).toBe(
      [
        "byro-repo #424",
        "  Ticket: #431, review, 30m 0s on this step",
        "  Account: 2",
        "  Latest (29m 59s ago): Limit wait: account 2 is at 95% of its 5-hour limit; continuing after 2026-10-25T13:05:00.000Z. A switch ends it.",
      ].join("\n"),
    );
  });

  it("shows an Idle run holding no account lease until its next launch", async () => {
    const launch =
      "byro-repo #432: implement step on account 1, raw stream in /s/2.jsonl.";
    const log = [
      "2026-10-25T11:00:07.000Z byro-repo #431: implement step on account 2, raw stream in /s/1.jsonl.",
      "2026-10-25T11:30:00.000Z Idle: nothing runnable. byro-repo #431 waits on Halt H1.",
    ];
    seedRun({
      stem: "byro-repo-424",
      pid: process.pid,
      steps: { "byro-repo #431": "halted" },
      log,
    });
    expect((await runsAt()).split("\n")[2]).toBe(
      "  Account: none; Idle, holding no account lease",
    );

    seedRun({
      stem: "byro-repo-424",
      pid: process.pid,
      steps: { "byro-repo #431": "halted", "byro-repo #432": "implement" },
      log: [...log, `2026-10-25T11:40:00.000Z ${launch}`],
    });
    expect((await runsAt()).split("\n")[2]).toBe("  Account: 1");
  });

  it("shows a spec-level step, such as the gap check, in place of a ticket", async () => {
    seedRun({
      stem: "byro-repo-424",
      pid: process.pid,
      steps: { "byro-repo #431": "landed" },
      log: [
        "2026-10-25T11:40:00.000Z byro-repo #431: wrap-up took 30s.",
        "2026-10-25T11:50:00.000Z Gap check step on account 1, raw stream in /s/g.jsonl.",
      ],
    });
    expect((await runsAt()).split("\n")[1]).toBe(
      "  Ticket: none; Gap check, 10m 0s on this step",
    );
  });

  it("marks a run whose lock's pid is dead", async () => {
    seedRun({
      stem: "personal-21",
      pid: deadPid(),
      steps: { "personal #22": "implement" },
      log: [
        "2026-10-25T10:00:00.000Z personal #22: launching on Sonnet high from implement.",
        "2026-10-25T10:00:01.000Z personal #22: implement step on account 1, raw stream in /s/3.jsonl.",
      ],
    });
    expect(await runsAt()).toBe(
      [
        "personal #21: process gone; Vanished unless its event file ends in a run-ended line",
        "  Ticket: #22, implement, 2h 0m on this step",
        "  Account: 1",
        "  Latest (1h 59m ago): personal #22: implement step on account 1, raw stream in /s/3.jsonl.",
      ].join("\n"),
    );
  });

  it("shows a run still in preflight, with no run state yet", async () => {
    seedHolder(join(stateFolder, "byro-repo-424.run.lock"), {
      pid: process.pid,
      host: hostname(),
      startedAt: "2026-10-25T11:59:58.000Z",
    });
    expect(await runsAt()).toBe(
      [
        "byro-repo #424",
        "  Ticket: none yet",
        "  Account: none launched yet",
        "  Latest: none",
      ].join("\n"),
    );
  });

  it("puts one block per run, blank-line separated, and says so with none above the Accounts section", async () => {
    expect(await boardAt()).toBe(
      ["No runs are running.", "", accountsText].join("\n"),
    );
    seedRun({ stem: "byro-repo-424", pid: process.pid, steps: {}, log: [] });
    seedRun({ stem: "personal-21", pid: process.pid, steps: {}, log: [] });
    expect((await runsAt()).split("\n\n")).toHaveLength(2);
  });

  it("shows a Batch as one block naming its current member, ticket and step", async () => {
    seedRun({
      stem: "byro-repo-498",
      pid: process.pid,
      steps: { "byro-repo #510": "landed" },
      log: [
        "2026-10-25T11:00:06.000Z byro-repo #510: launching on Opus medium from implement.",
        "2026-10-25T11:00:07.000Z byro-repo #510: implement step on account 2, raw stream in /s/1.jsonl.",
        "2026-10-25T11:20:00.000Z byro-repo #510: wrap-up took 30s.",
      ],
    });
    seedRun({
      stem: "byro-repo-499",
      pid: process.pid,
      steps: { "byro-repo #520": "implement" },
      log: [
        "2026-10-25T11:30:00.000Z byro-repo #520: launching on Opus high from implement.",
        "2026-10-25T11:30:01.000Z byro-repo #520: implement step on account 1, raw stream in /s/2.jsonl.",
      ],
    });
    seedRun({ stem: "byro-repo-450", pid: process.pid, steps: {}, log: [] });
    seedRun({ stem: "personal-21", pid: process.pid, steps: {}, log: [] });
    await BatchRecords.init(stateFolder).open(
      [
        { repo: "byro-repo", number: 498 },
        { repo: "byro-repo", number: 499 },
        { repo: "byro-repo", number: 450 },
      ],
      process.pid,
    );

    const blocks = (await runsAt()).split("\n\n");

    expect(blocks).toHaveLength(2);
    expect(blocks).toContain(
      [
        "Batch byro-repo #498, #499, #450",
        "  Member: byro-repo #499",
        "  Ticket: #520, implement, 30m 0s on this step",
        "  Account: 1",
        "  Latest (29m 59s ago): byro-repo #520: implement step on account 1, raw stream in /s/2.jsonl.",
      ].join("\n"),
    );
  });

  it("shows a lone run's tickets left, counting the current, halted and unstarted tickets and not an earlier run's landings", async () => {
    seedRun({
      stem: "byro-repo-424",
      pid: process.pid,
      steps: {
        "byro-repo #430": "landed",
        "byro-repo #431": "review",
        "byro-repo #432": "halted",
      },
      ticketLabels: [
        "byro-repo #430",
        "byro-repo #431",
        "byro-repo #432",
        "byro-repo #433",
      ],
      log: [
        "2026-10-25T11:00:06.000Z byro-repo #431: launching on Opus medium from implement.",
      ],
    });
    expect((await runsAt()).split("\n").slice(0, 3)).toEqual([
      "byro-repo #424",
      "  Tickets left: 3 of 4",
      "  Ticket: #431, review, 59m 54s on this step",
    ]);
  });

  it("shows a Batch's tickets left as one total across its members", async () => {
    seedRun({
      stem: "byro-repo-498",
      pid: process.pid,
      steps: { "byro-repo #510": "landed", "byro-repo #511": "landed" },
      ticketLabels: ["byro-repo #510", "byro-repo #511"],
      log: [],
    });
    seedRun({
      stem: "byro-repo-499",
      pid: process.pid,
      steps: { "byro-repo #520": "implement" },
      ticketLabels: ["byro-repo #520", "byro-repo #521"],
      log: [],
    });
    await BatchRecords.init(stateFolder).open(
      [
        { repo: "byro-repo", number: 498 },
        { repo: "byro-repo", number: 499 },
      ],
      process.pid,
    );
    expect((await runsAt()).split("\n").slice(0, 3)).toEqual([
      "Batch byro-repo #498, #499",
      "  Member: byro-repo #498",
      "  Tickets left: 2 of 4",
    ]);
  });

  it("shows no tickets left for a Batch with a member whose run state has no ticket list", async () => {
    seedRun({
      stem: "byro-repo-498",
      pid: process.pid,
      steps: {},
      ticketLabels: ["byro-repo #510"],
      log: [],
    });
    seedRun({ stem: "byro-repo-499", pid: process.pid, steps: {}, log: [] });
    await BatchRecords.init(stateFolder).open(
      [
        { repo: "byro-repo", number: 498 },
        { repo: "byro-repo", number: 499 },
      ],
      process.pid,
    );
    expect(await runsAt()).not.toContain("Tickets left");
  });

  it("shows no tickets left, and still renders, for a run state an older runner wrote with no ticket list", async () => {
    seedRun({
      stem: "byro-repo-424",
      pid: process.pid,
      steps: { "byro-repo #431": "implement" },
      log: [],
    });
    expect(await runsAt()).toBe(
      [
        "byro-repo #424",
        "  Ticket: none yet",
        "  Account: none launched yet",
        "  Latest: none",
      ].join("\n"),
    );
  });

  it("says so when the state folder doesn't exist yet", async () => {
    expect(await runsAt(join(stateFolder, "missing"))).toBe(
      "No runs are running.",
    );
  });
});

describe("watchBoard", () => {
  it("redraws every poll until interrupted", async () => {
    const drawn: string[] = [];
    let sleeps = 0;
    const watching = watchBoard({
      render: async () => `board ${drawn.length}`,
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

  it("redraws every 5s and reads accounts every 60s, counting the reading's age up in between", async () => {
    const { accounts, usageReader } = accountsOf(
      boardTimings.accountsRefreshMs,
    );
    const drawn: string[] = [];
    let clockMs = now.getTime();
    const watching = watchBoard({
      render: () =>
        runBoardOf({ stateFolder, accounts, now: new Date(clockMs) }),
      draw: (board) => drawn.push(board),
      pollMs: boardTimings.redrawMs,
      sleep: async (ms) => {
        clockMs += ms;
        if (drawn.length === 14) throw new Error("interrupted");
      },
    });
    await expect(watching).rejects.toThrow("interrupted");

    const headings = drawn.map(
      (board) => board.split("\n\n").at(-1)?.split("\n")[0],
    );
    expect(usageReader.readCount).toBe(2);
    expect(headings.slice(0, 3)).toEqual([
      "Accounts",
      "Accounts (read 5s ago)",
      "Accounts (read 10s ago)",
    ]);
    expect(headings.slice(11)).toEqual([
      "Accounts (read 55s ago)",
      "Accounts",
      "Accounts (read 5s ago)",
    ]);
  });
});
