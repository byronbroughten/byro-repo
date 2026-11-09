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
  notices,
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

  it("marks only the relaunch's run-started as a relaunch", async () => {
    addSpec([1, 2]);

    await specRun(
      FakeAgentStep.init(implemented("runner/one.ts"), reviewed()),
    ).run(spec);
    await specRun(FakeAgentStep.init(implemented("two.ts"), reviewed())).run(
      spec,
    );

    expect(
      notices.sent
        .filter(({ kind }) => kind === "run-started")
        .map(({ isRelaunch }) => isRelaunch),
    ).toEqual([undefined, true]);
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

// The members whose run-started notice carries the relaunch mark, which the event line leaves out.
function relaunchStarts(): number[] {
  return notices.sent
    .filter(({ kind, isRelaunch }) => kind === "run-started" && isRelaunch)
    .map(({ spec: member }) => member.number);
}

describe("a Batch's Restart", () => {
  it("writes one run-started on the member it launches, and no second member-ended for a member that ended before the Restart", async () => {
    const before = await restartBatch();

    const relaunch = await runBatch(
      FakeAgentStep.init(implemented("third.ts"), reviewed()),
    );

    expect(relaunch.kind).toBe("finished");
    const lines = batchEventLines(members).slice(before);
    expect(lines.map(({ spec, kind }) => [spec, kind])).toEqual([
      ["byro-repo#303", "run-started"],
      ["byro-repo#302", "member-ended"],
      ["byro-repo#303", "member-ended"],
      ["byro-repo#301", "run-ended"],
    ]);
    expect(relaunchStarts()).toEqual([303]);
    expect(lines.at(-1)?.summary).toBe(
      "Batch ended: byro-repo #301, byro-repo #302, byro-repo #303 landed. Review lists: nothing needs judging.",
    );
  });

  it("writes its run-started on the first unfinished member when the relaunch launches none", async () => {
    github.blockers.set(third.number, [second.number]);
    const before = await restartBatch();
    // Left open by its landing, so the third member waits on it at the relaunch's first pick.
    github.edit(second.number, { isOpen: true });

    await runBatch(FakeAgentStep.init(implemented("third.ts"), reviewed()));

    const started = batchEventLines(members)
      .slice(before)
      .filter(({ kind }) => kind === "run-started");
    expect(started.map(({ spec }) => spec)).toEqual(["byro-repo#302"]);
    expect(relaunchStarts()).toEqual([302]);
  });

  it("relaunches from a restart saved before it kept each member's end, ending that member again", async () => {
    const before = await restartBatch();
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
    const ended = batchEventLines(members)
      .slice(before)
      .filter(({ kind }) => kind === "member-ended");
    expect(ended.map(({ spec }) => spec)).toEqual([
      "byro-repo#301",
      "byro-repo#302",
      "byro-repo#303",
    ]);
  });
});
