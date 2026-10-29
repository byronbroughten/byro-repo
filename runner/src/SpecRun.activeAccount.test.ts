import { describe, expect, it } from "vitest";

import type { StepResult } from "./AgentStep.ts";
import { FakeAgentStep, type ScriptedStep } from "./FakeAgentStep.ts";
import type { UsageReader } from "./limitGuard.ts";
import {
  addSpec,
  crashed,
  eventOf,
  implemented,
  noticeSummaries,
  progressLines,
  refOf,
  reviewed,
  scriptUsage,
  spec,
  specRun,
  usageListOf,
  useSpecRunHarness,
} from "./specRunHarness.ts";

useSpecRunHarness();

// Both accounts read the same usage; only which one cswap reports active changes.
let activeAccount: number | undefined;
const switchableReader: UsageReader = {
  read: async () => ({ ...usageListOf(0.1, 0.2), activeAccount }),
};

// Runs the step, then switches the active account, as `cswap switch` mid-run would.
function thenSwitchTo(account: number, step: ScriptedStep): ScriptedStep {
  return async (request) => {
    const result: StepResult =
      typeof step === "function" ? await step(request) : step;
    activeAccount = account;
    return result;
  };
}

describe("run's active account", () => {
  it("launches each fresh step on the account active just before it, so a switch between steps moves the next", async () => {
    addSpec([1]);
    activeAccount = 1;
    const agentStep = FakeAgentStep.init(
      thenSwitchTo(2, implemented("one.ts")),
      reviewed(),
    );

    const result = await specRun(agentStep, {
      usageReader: switchableReader,
    }).run(spec);

    expect(result.landed).toEqual([refOf(1)]);
    expect(agentStep.requests.map(({ account }) => account)).toEqual([1, 2]);
  });

  it("names the account each step launched on in the progress log", async () => {
    addSpec([1]);
    activeAccount = 1;
    const agentStep = FakeAgentStep.init(
      thenSwitchTo(2, implemented("one.ts")),
      reviewed(),
    );

    await specRun(agentStep, { usageReader: switchableReader }).run(spec);

    const launches = progressLines()
      .map(eventOf)
      .filter((line) => line.includes(" step on account "));
    expect(launches.map((line) => line.split(", raw stream")[0])).toEqual([
      "byro-repo #1: implement step on account 1",
      "byro-repo #1: review step on account 2",
      "Gap check step on account 2",
    ]);
  });

  it("resumes a crashed session on the account it recorded, even after the active account changes", async () => {
    addSpec([1]);
    activeAccount = 1;
    const agentStep = FakeAgentStep.init(
      thenSwitchTo(2, crashed),
      implemented("one.ts"),
      reviewed(),
    );

    const result = await specRun(agentStep, {
      usageReader: switchableReader,
    }).run(spec);

    expect(result.landed).toEqual([refOf(1)]);
    expect(
      agentStep.requests.map(({ account, resumeSessionId }) => ({
        account,
        resumeSessionId,
      })),
    ).toEqual([
      { account: 1, resumeSessionId: undefined },
      { account: 1, resumeSessionId: "crashed-session" },
      { account: 2, resumeSessionId: undefined },
    ]);
  });

  it("Stops before any step, naming cswap, when cswap reports no active account", async () => {
    addSpec([1]);
    activeAccount = undefined;
    const agentStep = FakeAgentStep.init();

    const result = await specRun(agentStep, {
      usageReader: switchableReader,
    }).run(spec);

    expect(result.kind).toBe("stopped");
    expect(result.message).toContain("cswap");
    expect(agentStep.requests).toHaveLength(0);
  });

  it("Stops before any step, naming cswap, when the usage read fails", async () => {
    addSpec([1]);
    scriptUsage(new Error("cswap: not found"));
    const agentStep = FakeAgentStep.init();

    const result = await specRun(agentStep).run(spec);

    expect(result.kind).toBe("stopped");
    expect(result.message).toContain("cswap");
    expect(agentStep.requests).toHaveLength(0);
  });

  it("Stops before the next fresh step, naming cswap, when the active account becomes unreadable mid-run", async () => {
    addSpec([1]);
    activeAccount = 1;
    const agentStep = FakeAgentStep.init(async (request) => {
      const result = await implemented("one.ts")(request);
      activeAccount = undefined;
      return result;
    }, reviewed());

    const result = await specRun(agentStep, {
      usageReader: switchableReader,
    }).run(spec);

    expect(result.kind).toBe("stopped");
    expect(result.message).toContain("cswap");
    expect(agentStep.requests).toHaveLength(1);
  });

  it("guards the account the step will run on, naming it in the Limit wait", async () => {
    addSpec([1]);
    activeAccount = 2;
    let read = 0;
    const reader: UsageReader = {
      read: async () =>
        read++ === 1
          ? { readings: overAccount2(), activeAccount: 2 }
          : usageListOf(0.1, 0.2, 2),
    };
    const agentStep = FakeAgentStep.init(implemented("one.ts"), reviewed());

    const result = await specRun(agentStep, { usageReader: reader }).run(spec);

    expect(result.landed).toEqual([refOf(1)]);
    expect(noticeSummaries()[1]).toMatch(
      /^Limit wait: account 2 is at 92% of its 5-hour limit/,
    );
    expect(agentStep.requests.map(({ account }) => account)).toEqual([2, 2]);
  });
});

// Account 2 past its 5-hour pause; account 1 idle, so a guard reading the wrong account would launch.
function overAccount2() {
  return usageListOf(0.1, 0.2, 2).readings.map((reading) =>
    reading.account === 2 && reading.usage !== undefined
      ? {
          ...reading,
          usage: {
            ...reading.usage,
            fiveHour: { ...reading.usage.fiveHour, utilization: 0.92 },
          },
        }
      : reading,
  );
}
