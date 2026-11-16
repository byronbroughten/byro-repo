import { describe, expect, it } from "vitest";

import type { StepResult } from "./AgentStep.ts";
import { FakeAgentStep, type ScriptedStep } from "./FakeAgentStep.ts";
import type { UsageReader } from "./limitGuard.ts";
import {
  accountsListOf,
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

// Account 1 carries the usage a step moves; only which account cswap reports active changes otherwise.
let activeAccount: number | undefined;
let account1FiveHour = 0.1;
const switchableReader: UsageReader = {
  read: async () => ({ ...usageListOf(account1FiveHour, 0.2), activeAccount }),
};

// Runs the step, then puts account 1 past its 5-hour threshold, as the step's own use would.
function thenPastThreshold(step: ScriptedStep): ScriptedStep {
  return async (request) => {
    const result: StepResult =
      typeof step === "function" ? await step(request) : step;
    account1FiveHour = 0.95;
    return result;
  };
}

describe("run's active account", () => {
  it("launches a step on the run's account until it is past a threshold, then on the Active account as the only one under", async () => {
    addSpec([1]);
    activeAccount = 2;
    account1FiveHour = 0.1;
    const agentStep = FakeAgentStep.init(
      thenPastThreshold(implemented("one.ts")),
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
    activeAccount = 2;
    account1FiveHour = 0.1;
    const agentStep = FakeAgentStep.init(
      thenPastThreshold(implemented("one.ts")),
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

  it("resumes a crashed session that ran on account 1 on the account the launch check gives", async () => {
    addSpec([1]);
    activeAccount = 2;
    account1FiveHour = 0.1;
    const agentStep = FakeAgentStep.init(
      thenPastThreshold(crashed),
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
      { account: 2, resumeSessionId: "crashed-session" },
      { account: 2, resumeSessionId: "session" },
    ]);
  });

  it("Stops before any step, naming cswap, when cswap reports no active account", async () => {
    addSpec([1]);
    activeAccount = undefined;
    account1FiveHour = 0.1;
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
    account1FiveHour = 0.1;
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

  it("launches on account 1 with no Limit wait while the Active account is past its threshold", async () => {
    addSpec([1]);
    scriptUsage(
      accountsListOf(
        [
          { account: 1, fiveHour: 0.1, sevenDay: 0.2 },
          { account: 2, fiveHour: 0.95, sevenDay: 0.2 },
        ],
        2,
      ),
    );
    const agentStep = FakeAgentStep.init(implemented("one.ts"), reviewed());

    const result = await specRun(agentStep).run(spec);

    expect(result.landed).toEqual([refOf(1)]);
    expect(
      noticeSummaries().filter((summary) => summary.startsWith("Limit wait")),
    ).toEqual([]);
    expect(agentStep.requests.map(({ account }) => account)).toEqual([1, 1]);
  });
});
