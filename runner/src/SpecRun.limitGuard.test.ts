import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import type { StepResult } from "./AgentStep.ts";
import { FakeAgentStep, type ScriptedStep } from "./FakeAgentStep.ts";
import type { RunResult } from "./SpecRun.ts";
import {
  addIssue,
  addSpec,
  after,
  github,
  implemented,
  noticeSummaries,
  readingOf,
  refOf,
  resultOf,
  reviewed,
  scriptUsage,
  spec,
  specRun,
  stateFolder,
  timed,
  timingLines,
  useSpecRunHarness,
} from "./specRunHarness.ts";

useSpecRunHarness();

describe("run's limit guard", () => {
  it("waits out a 5-hour limit on the configured account until the reset plus a margin, with one notice, then lands", async () => {
    addSpec([1]);
    scriptUsage(
      readingOf(0.92, 0.5),
      readingOf(0.92, 0.5),
      readingOf(0.1, 0.5),
    );
    const sleeps: number[] = [];
    const agentStep = FakeAgentStep.init(implemented("one.ts"), reviewed());

    const result = await specRun(agentStep, {
      async sleep(ms) {
        sleeps.push(ms);
      },
    }).run(spec);

    expect(result.landed).toEqual([refOf(1)]);
    expect(sleeps).toEqual([2 * 60 * 60_000 + 5 * 60_000]);
    expect(noticeSummaries()).toEqual([
      "Run started on 1 tickets as account 1: 5-hour 92%, weekly 50%.",
      "Limit wait: account 1 is at 92% of its 5-hour limit; continuing after 2026-10-12T11:05:00.000Z.",
      result.message,
    ]);
  });

  it("Stops before a step past the weekly reserve, with one notice, leaving the ticket for a rerun to resume", async () => {
    addSpec([1]);
    scriptUsage(readingOf(0.3, 0.96));
    const agentStep = FakeAgentStep.init();

    const result = await specRun(agentStep).run(spec);

    expect(result).toEqual<RunResult>({
      kind: "stopped",
      landed: [],
      message:
        "Account 1 is at 96% of its weekly limit, past the reserve; rerun after it resets at 2026-10-15T00:00:00.000Z.",
    });
    expect(agentStep.requests).toEqual([]);
    expect(noticeSummaries()).toEqual([
      "Run started on 1 tickets as account 1: 5-hour 30%, weekly 96%.",
      result.message,
    ]);
    scriptUsage(readingOf(0.3, 0.5));

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
    scriptUsage(new Error("cswap: not found"));
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

  it("pushes one Limit wait notice though a reading after the wait is still over", async () => {
    addSpec([1]);
    scriptUsage(
      readingOf(0.92, 0.5),
      readingOf(0.92, 0.5),
      readingOf(0.92, 0.5),
      readingOf(0.1, 0.5),
    );

    const result = await specRun(
      FakeAgentStep.init(implemented("one.ts"), reviewed()),
    ).run(spec);

    expect(result.landed).toEqual([refOf(1)]);
    expect(
      noticeSummaries().filter((summary) => summary.startsWith("Limit wait")),
    ).toHaveLength(1);
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
