import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import type { StepResult } from "./AgentStep.ts";
import { FakeAgentStep, type ScriptedStep } from "./FakeAgentStep.ts";
import type { UsageReader } from "./limitGuard.ts";
import type { RunResult } from "./SpecRun.ts";
import {
  addIssue,
  addSpec,
  after,
  crashed,
  github,
  implemented,
  noticeSummaries,
  refOf,
  resultOf,
  reviewed,
  scriptUsage,
  spec,
  specRun,
  stateFolder,
  timed,
  timingLines,
  usageListOf,
  useSpecRunHarness,
} from "./specRunHarness.ts";

useSpecRunHarness();

describe("run's limit guard", () => {
  it("re-reads the account every idlePollMs during a Limit wait, with one notice, then lands", async () => {
    addSpec([1]);
    scriptUsage(
      usageListOf(0.92, 0.5),
      usageListOf(0.92, 0.5),
      usageListOf(0.92, 0.5),
      usageListOf(0.1, 0.5),
    );
    const sleeps: number[] = [];
    const agentStep = FakeAgentStep.init(implemented("one.ts"), reviewed());

    const result = await specRun(agentStep, {
      async sleep(ms) {
        sleeps.push(ms);
      },
    }).run(spec);

    expect(result.landed).toEqual([refOf(1)]);
    expect(sleeps).toEqual([60_000, 60_000]);
    expect(noticeSummaries()).toEqual([
      "Run started on 1 tickets as account 1: 5-hour 92%, weekly 50%.",
      "Limit wait: account 1 is at 92% of its 5-hour limit; continuing after 2026-10-12T11:05:00.000Z. Switching to an account with headroom with cswap continues the run now.",
      result.message,
    ]);
  });

  it("shortens the last poll of a Limit wait to end at the reset plus the margin", async () => {
    addSpec([1]);
    scriptUsage(
      usageListOf(0.92, 0.5),
      usageListOf(0.92, 0.5),
      usageListOf(0.1, 0.5),
    );
    const sleeps: number[] = [];

    await specRun(FakeAgentStep.init(implemented("one.ts"), reviewed()), {
      clock: { now: () => new Date("2026-10-12T11:04:30Z") },
      async sleep(ms) {
        sleeps.push(ms);
      },
    }).run(spec);

    expect(sleeps).toEqual([30_000]);
  });

  it("launches on the account switched to at the next poll of a Limit wait", async () => {
    addSpec([1]);
    let activeAccount = 1;
    const usageReader: UsageReader = {
      read: async () => ({ ...usageListOf(0.92, 0.5), activeAccount }),
    };
    const sleeps: number[] = [];
    const agentStep = FakeAgentStep.init(implemented("one.ts"), reviewed());

    const result = await specRun(agentStep, {
      usageReader,
      async sleep(ms) {
        sleeps.push(ms);
        activeAccount = 2;
      },
    }).run(spec);

    expect(result.landed).toEqual([refOf(1)]);
    expect(sleeps).toEqual([60_000]);
    expect(agentStep.requests.map(({ account }) => account)).toEqual([2, 2]);
  });

  it("keeps a resumed step's Limit wait on its recorded account after a switch", async () => {
    addSpec([1]);
    let activeAccount = 1;
    let account1FiveHour = 0.1;
    const usageReader: UsageReader = {
      read: async () => ({
        ...usageListOf(account1FiveHour, 0.5),
        activeAccount,
      }),
    };
    const crashThenSwitch: ScriptedStep = async () => {
      activeAccount = 2;
      account1FiveHour = 0.92;
      return crashed;
    };
    const sleeps: number[] = [];
    const agentStep = FakeAgentStep.init(
      crashThenSwitch,
      implemented("one.ts"),
      reviewed(),
    );

    const result = await specRun(agentStep, {
      usageReader,
      async sleep(ms) {
        sleeps.push(ms);
        if (sleeps.length === 2) account1FiveHour = 0.1;
      },
    }).run(spec);

    expect(result.landed).toEqual([refOf(1)]);
    expect(sleeps).toEqual([60_000, 60_000]);
    expect(agentStep.requests.map(({ account }) => account)).toEqual([1, 1, 2]);
    expect(noticeSummaries()).toContain(
      "Limit wait: account 1 is at 92% of its 5-hour limit; continuing after 2026-10-12T11:05:00.000Z. A resumed session stays on its recorded account, so switching with cswap won't end this wait.",
    );
  });

  it("Stops before a step past the weekly reserve, with one notice, leaving the ticket for a rerun to resume", async () => {
    addSpec([1]);
    scriptUsage(usageListOf(0.3, 0.96));
    const agentStep = FakeAgentStep.init();

    const result = await specRun(agentStep).run(spec);

    expect(result).toEqual<RunResult>({
      kind: "stopped",
      landed: [],
      message:
        "Account 1 is at 96% of its weekly limit, past the reserve; switch with cswap and rerun, or rerun after it resets at 2026-10-15T00:00:00.000Z.",
    });
    expect(agentStep.requests).toEqual([]);
    expect(noticeSummaries()).toEqual([
      "Run started on 1 tickets as account 1: 5-hour 30%, weekly 96%.",
      result.message,
    ]);
    scriptUsage(usageListOf(0.3, 0.5));

    const rerun = await specRun(
      FakeAgentStep.init(implemented("one.ts"), reviewed()),
    ).run(spec);

    expect(rerun.landed).toEqual([refOf(1)]);
  });

  function limitHitStep(
    stream: string,
    limitHit: StepResult["limitHit"],
  ): ScriptedStep {
    return async (request) => {
      writeFileSync(request.logPath ?? "", stream);
      return {
        ...resultOf(undefined),
        output: { status: "none" },
        exitSubtype: "error_during_execution",
        limitHit,
      };
    };
  }

  function savedLimitHit(): string {
    return readFileSync(join(stateFolder(), "first-limit-hit.jsonl"), "utf8");
  }

  it("Stops unhandled on a limit hit mid-step, naming the reset, and keeps the first limit-hit stream it sees", async () => {
    addSpec([1]);
    const hit = {
      window: "five_hour",
      resetsAt: new Date("2026-10-12T11:00:00Z"),
    };

    const result = await specRun(
      FakeAgentStep.init(limitHitStep("first stream\n", hit)),
    ).run(spec);

    expect(result.message).toBe(
      "Stopped on byro-repo #1: a limit hit; rerun to retry it.",
    );
    expect(github.issues.get(1)?.isOpen).toBe(true);
    expect(github.comments[0]?.body).toContain(
      "The step hit the five_hour limit; it resets at 2026-10-12T11:00:00.000Z.",
    );
    expect(github.comments[0]?.body).toContain(
      "The ticket is left at its implement step in its issue workspace; rerun to retry it: `npm run runner -- byronbroughten/byro-repo 213`.",
    );
    expect(savedLimitHit()).toBe("first stream\n");
    addIssue(2);
    github.subIssues.set(spec.number, [1, 2]);
    github.edit(1, { isOpen: false });

    await specRun(FakeAgentStep.init(limitHitStep("later stream\n", hit))).run(
      spec,
    );

    expect(savedLimitHit()).toBe("first stream\n");
  });

  it("warns once on a limit error with no reset and Stops unhandled", async () => {
    addSpec([1]);

    const result = await specRun(
      FakeAgentStep.init(
        limitHitStep("bare 429\n", { window: undefined, resetsAt: undefined }),
      ),
    ).run(spec);

    expect(result.message).toBe(
      "Stopped on byro-repo #1: a limit hit; rerun to retry it.",
    );
    expect(github.comments[0]?.body).toContain(
      "The step hit an unrecognised limit error; its reset is unknown.",
    );
    expect(noticeSummaries()).toEqual([
      "Run started on 1 tickets as account 1: 5-hour 10%, weekly 20%.",
      "Unrecognised limit error on account 1; the saved stream can tighten detection.",
      result.message,
    ]);
    expect(savedLimitHit()).toBe("bare 429\n");
  });

  it("warns once per run on a missing reading and launches each step unguarded", async () => {
    addSpec([1, 2]);
    scriptUsage({
      readings: [{ account: 1, usage: undefined }],
      activeAccount: 1,
    });
    const agentStep = FakeAgentStep.init(
      implemented("one.ts"),
      reviewed(),
      implemented("two.ts"),
      reviewed(),
    );

    const result = await specRun(agentStep).run(spec);

    expect(result.landed).toEqual([refOf(1), refOf(2)]);
    expect(noticeSummaries()).toEqual([
      "Run started on 2 tickets as account 1: no usage reading.",
      "No usage reading for account 1; steps launch unguarded.",
      result.message,
    ]);
  });

  it("lands a step that met a limit but still succeeded", async () => {
    addSpec([1]);
    const hit = { window: "five_hour", resetsAt: undefined };

    const result = await specRun(
      FakeAgentStep.init(implemented("one.ts"), {
        ...reviewed(),
        limitHit: hit,
      }),
    ).run(spec);

    expect(result.landed).toEqual([refOf(1)]);
  });
});

describe("run's timings", () => {
  it("logs preflight's time before Run started, then each step's time in the order the steps ran", async () => {
    addSpec([1]);

    await specRun(
      FakeAgentStep.init(
        after(90.4, implemented("one.ts")),
        after(29.6, reviewed()),
      ),
      timed(),
    ).run(spec);

    expect(timingLines()).toEqual([
      "Preflight passed in 0s.",
      "Run started on 1 tickets as account 1: 5-hour 10%, weekly 20%.",
      "byro-repo #1: workspace took 4s.",
      "byro-repo #1: implement took 90s.",
      "byro-repo #1: review took 30s.",
      "byro-repo #1: checks took 0s.",
      "byro-repo #1: wrap-up took 0s.",
    ]);
  });

  it("logs the time of a step that ends in a Stop, and of no step after it", async () => {
    addSpec([1]);
    const stepError: StepResult = {
      ...reviewed(),
      output: { status: "none" },
      exitSubtype: "error_max_budget_usd",
    };

    await specRun(
      FakeAgentStep.init(
        after(60, implemented("one.ts")),
        after(20, stepError),
      ),
      timed(),
    ).run(spec);

    expect(timingLines()).toEqual([
      "Preflight passed in 0s.",
      "Run started on 1 tickets as account 1: 5-hour 10%, weekly 20%.",
      "byro-repo #1: workspace took 4s.",
      "byro-repo #1: implement took 60s.",
      "byro-repo #1: review took 20s.",
    ]);
  });
});
