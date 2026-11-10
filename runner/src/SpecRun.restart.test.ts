import { readFileSync, writeFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import { FakeAgentStep } from "./FakeAgentStep.ts";
import type { IssueRef } from "./IssueWorkspaces.ts";
import type { MemberList, RunResult } from "./SpecRun.ts";
import {
  addIssue,
  addSpec,
  batchEventLines,
  eventOf,
  github,
  implemented,
  noticeKinds,
  progressEventsAfter,
  progressLines,
  refOf,
  reviewed,
  rootCloneOnly,
  runStatePath,
  spec,
  specRun,
  useSpecRunHarness,
  withEventFile,
} from "./specRunHarness.ts";

useSpecRunHarness(rootCloneOnly);

const restartMessage =
  "Restarting: the runner changed since the run started, found after landing byro-repo #1; relaunching on the landed code.";

describe("run's Restart", () => {
  it("ends the run restarting after a landing that changes the runner, and the next run resumes at the following ticket", async () => {
    addSpec([1, 2]);

    const result = await specRun(
      FakeAgentStep.init(implemented("runner/one.ts"), reviewed()),
    ).run(spec);

    expect(result).toEqual<RunResult>({
      kind: "restarting",
      landed: [refOf(1)],
      message: restartMessage,
    });
    expect(progressLines().map(eventOf)).toContain(restartMessage);
    expect(noticeKinds()).toEqual(["run-started"]);

    const rerunStep = FakeAgentStep.init(implemented("two.ts"), reviewed());
    const rerun = await specRun(rerunStep).run(spec);

    expect(rerun.kind).toBe("finished");
    expect(rerun.landed).toEqual([refOf(1), refOf(2)]);
    expect(rerun.message).toContain("landed byro-repo #1, byro-repo #2");
  });

  it("sends no run-started on relaunch, its start reaching only the progress log", async () => {
    addSpec([1, 2]);
    await specRun(
      FakeAgentStep.init(implemented("runner/one.ts"), reviewed()),
    ).run(spec);
    const before = progressLines().length;

    await specRun(FakeAgentStep.init(implemented("two.ts"), reviewed())).run(
      spec,
    );

    expect(noticeKinds().filter((kind) => kind === "run-started")).toEqual([
      "run-started",
    ]);
    expect(progressEventsAfter(before)).toContainEqual(
      expect.stringMatching(
        /^Run started on 2 tickets as .+ Launching byro-repo #2\.$/,
      ),
    );
  });

  it("writes the run's ticket list into the run state at its start, and rewrites it on relaunch from the spec's tickets as they are", async () => {
    addSpec([1, 2]);
    const ticketLabelsSaved = (): unknown =>
      JSON.parse(readFileSync(runStatePath(), "utf8")).ticketLabels;

    await specRun(
      FakeAgentStep.init(implemented("runner/one.ts"), reviewed()),
    ).run(spec);
    expect(ticketLabelsSaved()).toEqual(["byro-repo #1", "byro-repo #2"]);

    addIssue(3);
    github.subIssues.set(spec.number, [1, 2, 3]);
    await specRun(
      FakeAgentStep.init(
        implemented("two.ts"),
        reviewed(),
        implemented("three.ts"),
        reviewed(),
      ),
    ).run(spec);

    expect(ticketLabelsSaved()).toEqual([
      "byro-repo #1",
      "byro-repo #2",
      "byro-repo #3",
    ]);
  });

  it("carries every landing across two Restarts, and none into a later run", async () => {
    addSpec([1, 2, 3]);

    await specRun(
      FakeAgentStep.init(implemented("runner/one.ts"), reviewed()),
    ).run(spec);
    await specRun(
      FakeAgentStep.init(implemented("runner/two.ts"), reviewed()),
    ).run(spec);
    const last = await specRun(
      FakeAgentStep.init(implemented("three.ts"), reviewed()),
    ).run(spec);
    const later = await specRun(FakeAgentStep.init()).run(spec);

    expect(last.landed).toEqual([refOf(1), refOf(2), refOf(3)]);
    expect(later.landed).toEqual([]);
  });

  it("restarts after a landing that changes the runner's scripts", async () => {
    addSpec([1, 2]);

    const result = await specRun(
      FakeAgentStep.init(implemented("scripts/runner/one.ts"), reviewed()),
    ).run(spec);

    expect(result.kind).toBe("restarting");
  });

  it("doesn't restart after a landing that touches neither runner path", async () => {
    addSpec([1, 2]);

    const result = await specRun(
      FakeAgentStep.init(
        implemented("scripts/one.ts"),
        reviewed(),
        implemented("runners.ts"),
        reviewed(),
      ),
    ).run(spec);

    expect(result.kind).toBe("finished");
    expect(result.landed).toEqual([refOf(1), refOf(2)]);
  });
});

const first = refOf(301);
const second = refOf(302);
const third = refOf(303);
const members: MemberList = [first, second, third];

// The first member lands, the second lands a runner change, and the third is left for the relaunch.
async function restartBatch(): Promise<number> {
  members.forEach(({ number }) => {
    addIssue(number);
  });
  const result = await runBatch(
    FakeAgentStep.init(
      implemented("first.ts"),
      reviewed(),
      implemented("runner/second.ts"),
      reviewed(),
    ),
  );
  expect(result.kind).toBe("restarting");
  return batchEventLines(members).length;
}

function runBatch(agentStep: FakeAgentStep): Promise<RunResult> {
  return specRun(agentStep, { members, ...withEventFile() }).run(...members);
}

describe("a Batch's Restart", () => {
  it("writes its first launch's run-started on each member, with its warnings and the ticket it launches", async () => {
    await restartBatch();

    const started = batchEventLines(members).filter(
      ({ kind }) => kind === "run-started",
    );
    expect(
      started.map(({ spec, warnings, ticket }) => [spec, warnings, ticket]),
    ).toEqual([
      ["byro-repo#301", [], "byro-repo#301"],
      ["byro-repo#302", [], undefined],
      ["byro-repo#303", [], undefined],
    ]);
  });

  it("writes no run-started on relaunch, logging its start on the member it launches, and no member-ended for its finished members", async () => {
    const before = await restartBatch();
    const logged = progressLines(third.number).length;

    const relaunch = await runBatch(
      FakeAgentStep.init(implemented("third.ts"), reviewed()),
    );

    expect(relaunch.kind).toBe("finished");
    const lines = batchEventLines(members).slice(before);
    expect(progressEventsAfter(logged, third.number)).toContainEqual(
      expect.stringMatching(/^Run started on 1 tickets as /),
    );
    expect(lines.map(({ spec, kind }) => [spec, kind])).toEqual([
      ["byro-repo#301", "run-ended"],
    ]);
    expect(lines.at(-1)?.summary).toBe(
      "Batch ended: byro-repo #301, byro-repo #302, byro-repo #303 landed. Review lists: nothing needs judging.",
    );
  });

  it("logs its start on the first unfinished member when the relaunch launches none, writing no run-started", async () => {
    github.blockers.set(third.number, [second.number]);
    const before = await restartBatch();
    const logged = progressLines(second.number).length;
    // Left open by its landing, so the third member waits on it at the relaunch's first pick.
    github.edit(second.number, { isOpen: true });

    await runBatch(FakeAgentStep.init(implemented("third.ts"), reviewed()));

    const started = batchEventLines(members)
      .slice(before)
      .filter(({ kind }) => kind === "run-started");
    expect(started).toEqual([]);
    expect(progressEventsAfter(logged, second.number)).toContainEqual(
      expect.stringMatching(/^Run started on /),
    );
  });

  it("relaunches from a restart saved before it kept each member's end, ending that member again", async () => {
    await restartBatch();
    const logged = progressLines(first.number).length;
    const path = runStatePath(first.number);
    const state = JSON.parse(readFileSync(path, "utf8")) as {
      restart: { landed: IssueRef[] };
    };
    writeFileSync(
      path,
      JSON.stringify({ ...state, restart: { landed: state.restart.landed } }),
    );

    const relaunch = await runBatch(
      FakeAgentStep.init(implemented("third.ts"), reviewed()),
    );

    expect(relaunch.kind).toBe("finished");
    expect(relaunch.landed).toEqual(members);
    expect(progressEventsAfter(logged, first.number)).toContainEqual(
      expect.stringMatching(/^Run ended: landed byro-repo #301\./),
    );
  });
});
