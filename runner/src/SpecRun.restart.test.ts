import { describe, expect, it } from "vitest";

import { FakeAgentStep } from "./FakeAgentStep.ts";
import type { RunResult } from "./SpecRun.ts";
import {
  addSpec,
  eventOf,
  implemented,
  notices,
  progressLines,
  refOf,
  reviewed,
  spec,
  specRun,
  useSpecRunHarness,
} from "./specRunHarness.ts";

useSpecRunHarness();

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
    expect(notices.sent.map(({ kind }) => kind)).toEqual(["run-started"]);

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
