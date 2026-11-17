import { appendFileSync, mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

import { describe, expect, it } from "vitest";

import { BatchRecords } from "./BatchRecords.ts";
import { eventFilePathOf } from "./EventFileNotices.ts";
import { FakeAgentStep } from "./FakeAgentStep.ts";
import {
  type IssueRef,
  issueRef,
  type LeaseHolder,
} from "./IssueWorkspaces.ts";
import { liveHolder, seedHolder } from "./lockFixture.ts";
import type {
  LaunchReport,
  MemberList,
  OpenResult,
  RunLauncher,
} from "./SpecRun.ts";
import {
  addSpec,
  refOf,
  rootCloneOnly,
  session,
  spec,
  specRun,
  stateFolder,
  useSpecRunHarness,
} from "./specRunHarness.ts";
import { SupervisionRecords } from "./SupervisionRecords.ts";

useSpecRunHarness(rootCloneOnly);

const first = refOf(301);
const second = refOf(302);
// This test process outlives each test, so it stands in for an earlier Supervisor's claude.
const earlierSupervisor: LeaseHolder = { kind: "session", pid: process.pid };

// Records each launch's members and reports the run started, as tmux.sh does on its run-started line.
class ScriptedLauncher implements RunLauncher {
  readonly launches: MemberList[] = [];
  private readonly report: LaunchReport;

  constructor(report: LaunchReport) {
    this.report = report;
  }

  async launch(members: MemberList): Promise<LaunchReport> {
    this.launches.push(members);
    return this.report;
  }
}

const started: LaunchReport = {
  text: "Started tmux session runner-byro-repo-213; attach with: tmux attach -t runner-byro-repo-213\nrun-started",
  isStarted: true,
};

function open(
  launcher: RunLauncher,
  ...named: MemberList
): Promise<OpenResult> {
  return specRun(FakeAgentStep.init()).open(named, {
    holder: session,
    launcher,
  });
}

function seedLiveRunLock(member: IssueRef): void {
  mkdirSync(stateFolder(), { recursive: true });
  seedHolder(
    join(stateFolder(), `${issueRef.fileStemOf(member)}.run.lock`),
    liveHolder(),
  );
}

function appendEvents(...lines: string[]): void {
  mkdirSync(stateFolder(), { recursive: true });
  for (const line of lines) {
    appendFileSync(eventFilePathOf(stateFolder(), spec), `${line}\n`);
  }
}

describe("open", () => {
  it("launches every named number when no run is live, printing the launch's report", async () => {
    addSpec([1]);
    const launcher = new ScriptedLauncher(started);

    const result = await open(launcher, first, second);

    expect(launcher.launches).toEqual([[first, second]]);
    expect(result.isLive).toBe(true);
    expect(result.text).toContain(
      "No run is live for byro-repo #301, #302; launched it.",
    );
    expect(result.text).toContain(started.text);
  });

  it("says the run isn't live when the launch's wait reports no start", async () => {
    addSpec([1]);
    const unknown: LaunchReport = {
      text: "The run's state is unknown: no run-started or run-ended line after 120s",
      isStarted: false,
    };

    const result = await open(new ScriptedLauncher(unknown), spec);

    expect(result.isLive).toBe(false);
    expect(result.text).toContain(unknown.text);
  });

  it("rejoins a live run as it is, launching nothing", async () => {
    addSpec([1]);
    seedLiveRunLock(spec);
    const launcher = new ScriptedLauncher(started);

    const result = await open(launcher, spec);

    expect(launcher.launches).toEqual([]);
    expect(result.isLive).toBe(true);
    expect(result.text).toContain(
      "The run of byro-repo #213 is live; rejoined it as it is and launched nothing.",
    );
  });

  it("rejoins a live Batch holding any named number, naming the Batch's list", async () => {
    addSpec([1]);
    await BatchRecords.init(stateFolder()).open([first, second], process.pid);
    seedLiveRunLock(first);
    const launcher = new ScriptedLauncher(started);

    const result = await open(launcher, second);

    expect(launcher.launches).toEqual([]);
    expect(result.text).toContain(
      "The Batch of byro-repo #301, #302 is live; rejoined it as it is and launched nothing.",
    );
    const record =
      await SupervisionRecords.init(stateFolder()).recordOf(session);
    expect(record?.members).toEqual([first, second]);
  });

  it("records this session as the Supervisor and prints each unexplained event line", async () => {
    addSpec([1]);
    seedLiveRunLock(spec);
    appendEvents('{"kind":"run-started"}', '{"kind":"landed"}');

    const result = await open(new ScriptedLauncher(started), spec);

    const record =
      await SupervisionRecords.init(stateFolder()).recordOf(session);
    expect(record?.members).toEqual([spec]);
    expect(result.text).toContain(
      '## Unexplained event lines\n\n{"kind":"run-started"}\n{"kind":"landed"}',
    );
  });

  it("says no event line is unexplained when none is", async () => {
    addSpec([1]);
    seedLiveRunLock(spec);

    const result = await open(new ScriptedLauncher(started), spec);

    expect(result.text).toContain("## Unexplained event lines\n\nNone.");
    expect(result.text).not.toContain("## Handoff from the last Supervisor");
  });

  it("prints a waiting handoff once and deletes it", async () => {
    addSpec([1]);
    seedLiveRunLock(spec);
    const records = SupervisionRecords.init(stateFolder());
    await records.supervise(earlierSupervisor, "byronbroughten", spec);
    await records.end(earlierSupervisor, "clear");
    const handoffPath = records.handoffPathOf(spec);
    mkdirSync(dirname(handoffPath), { recursive: true });
    writeFileSync(handoffPath, "Ticket 1 waits on H1.");

    const firstOpen = await open(new ScriptedLauncher(started), spec);
    const secondOpen = await open(new ScriptedLauncher(started), spec);

    expect(firstOpen.text).toContain(
      "## Handoff from the last Supervisor\n\nTicket 1 waits on H1.",
    );
    expect(secondOpen.text).not.toContain(
      "## Handoff from the last Supervisor",
    );
  });
});
