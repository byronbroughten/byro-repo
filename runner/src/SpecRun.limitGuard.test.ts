import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import type { LimitHit, StepRequest, StepResult } from "./AgentStep.ts";
import { FakeAgentStep, type ScriptedStep } from "./FakeAgentStep.ts";
import type { UsageReader } from "./limitGuard.ts";
import {
  addSpec,
  after,
  crashed,
  findingOf,
  github,
  implemented,
  noticeSummaries,
  refOf,
  resolved,
  resultOf,
  reviewed,
  scriptUsage,
  spec,
  specRun,
  stateFolder,
  ticketFacts,
  timed,
  timingLines,
  usageListOf,
  useSpecRunHarness,
} from "./specRunHarness.ts";
import { limitResumePrompt } from "./stepPrompts/resumePrompts.ts";

useSpecRunHarness();

describe("run's limit guard", () => {
  it("re-reads the account every idlePollMs during a Limit wait, with one notice, then lands", async () => {
    addSpec([1]);
    scriptUsage(
      usageListOf(0.95, 0.5),
      usageListOf(0.95, 0.5),
      usageListOf(0.95, 0.5),
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
      "Run started on 1 tickets as account 1: 5-hour 95%, weekly 50%. Launching byro-repo #1.",
      "Limit wait: account 1 is at 95% of its 5-hour limit; continuing after 2026-10-12 06:01:00 CDT. Switching to an account with headroom with cswap continues the run now.",
      result.message,
    ]);
  });

  it("shortens the last poll of a Limit wait to end at the reset plus the margin", async () => {
    addSpec([1]);
    scriptUsage(
      usageListOf(0.95, 0.5),
      usageListOf(0.95, 0.5),
      usageListOf(0.1, 0.5),
    );
    const sleeps: number[] = [];

    await specRun(FakeAgentStep.init(implemented("one.ts"), reviewed()), {
      clock: { now: () => new Date("2026-10-12T11:00:30Z") },
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
      read: async () => ({ ...usageListOf(0.95, 0.5), activeAccount }),
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

  it("ends a resumed step's Limit wait on a switch to an account under its threshold", async () => {
    addSpec([1]);
    let activeAccount = 1;
    let account1FiveHour = 0.1;
    const usageReader: UsageReader = {
      read: async () => ({
        ...usageListOf(account1FiveHour, 0.5),
        activeAccount,
      }),
    };
    const crashPastThreshold: ScriptedStep = async () => {
      account1FiveHour = 0.95;
      return crashed;
    };
    const sleeps: number[] = [];
    const agentStep = FakeAgentStep.init(
      crashPastThreshold,
      implemented("one.ts"),
      reviewed(),
    );

    const result = await specRun(agentStep, {
      usageReader,
      async sleep(ms) {
        sleeps.push(ms);
        activeAccount = 2;
      },
    }).run(spec);

    expect(result.landed).toEqual([refOf(1)]);
    expect(sleeps).toEqual([60_000]);
    expect(
      agentStep.requests.map(({ account, resumeSessionId }) => ({
        account,
        resumeSessionId,
      })),
    ).toEqual([
      { account: 1, resumeSessionId: undefined },
      { account: 2, resumeSessionId: "crashed-session" },
      { account: 2, resumeSessionId: undefined },
    ]);
    expect(noticeSummaries()).toContain(
      "Limit wait: account 1 is at 95% of its 5-hour limit; continuing after 2026-10-12 06:01:00 CDT. Switching to an account with headroom with cswap continues the run now.",
    );
  });

  it("waits before a step past the weekly line until a poll reads it under, then lands", async () => {
    addSpec([1]);
    scriptUsage(
      usageListOf(0.3, 1),
      usageListOf(0.3, 1),
      usageListOf(0.3, 0.5),
    );
    const sleeps: number[] = [];

    const result = await specRun(
      FakeAgentStep.init(implemented("one.ts"), reviewed()),
      {
        async sleep(ms) {
          sleeps.push(ms);
        },
      },
    ).run(spec);

    expect(result.landed).toEqual([refOf(1)]);
    expect(sleeps).toEqual([60_000]);
    expect(noticeSummaries()).toContain(
      "Limit wait: account 1 is at 100% of its weekly limit; continuing after 2026-10-14 19:01:00 CDT. Switching to an account with headroom with cswap continues the run now.",
    );
  });

  function limitHitStep(
    stream: string,
    limitHit: StepResult["limitHit"],
    act: () => void = () => {},
  ): ScriptedStep {
    return async (request) => {
      act();
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

  // Account 1's 5-hour reading, which a limit hit sends to 100% and every third poll of a wait back under.
  interface CappedAccount {
    usageReader: UsageReader;
    hit(): void;
    sleeps: number[];
    sleep(ms: number): Promise<void>;
  }

  function cappedAccount(): CappedAccount {
    let fiveHour = 0.5;
    const sleeps: number[] = [];
    return {
      usageReader: { read: async () => usageListOf(fiveHour, 0.5) },
      hit: () => {
        fiveHour = 1;
      },
      sleeps,
      async sleep(ms) {
        sleeps.push(ms);
        if (sleeps.length % 3 === 0) fiveHour = 0.1;
      },
    };
  }

  const fiveHourHit: LimitHit = {
    window: "fiveHour",
    resetsAt: new Date("2026-10-12T11:00:00Z"),
  };

  function requestsOf(agentStep: FakeAgentStep): object[] {
    return agentStep.requests.map(({ account, resumeSessionId, prompt }) => ({
      account,
      resumeSessionId,
      prompt,
    }));
  }

  it("waits out a 5-hour limit hit mid-step, resumes the same session told so, lands, and keeps the first limit-hit stream it sees", async () => {
    addSpec([1]);
    const account = cappedAccount();
    const agentStep = FakeAgentStep.init(
      limitHitStep("first stream\n", fiveHourHit, account.hit),
      limitHitStep("later stream\n", fiveHourHit, account.hit),
      implemented("one.ts"),
      reviewed(),
    );

    const result = await specRun(agentStep, account).run(spec);

    expect(result.landed).toEqual([refOf(1)]);
    expect(account.sleeps).toHaveLength(6);
    expect(requestsOf(agentStep).slice(1, 3)).toEqual([
      {
        account: 1,
        resumeSessionId: "session",
        prompt: limitResumePrompt,
      },
      {
        account: 1,
        resumeSessionId: "session",
        prompt: limitResumePrompt,
      },
    ]);
    expect(github.comments.map(({ body }) => body).join("\n")).not.toContain(
      "limit hit",
    );
    expect(
      noticeSummaries().filter((summary) => summary.startsWith("Limit wait")),
    ).toEqual([
      "Limit wait: account 1 hit its 5-hour limit; continuing after 2026-10-12 06:01:00 CDT. Switching to an account with headroom with cswap continues the run now.",
      "Limit wait: account 1 hit its 5-hour limit; continuing after 2026-10-12 06:01:00 CDT. Switching to an account with headroom with cswap continues the run now.",
    ]);
    expect(savedLimitHit()).toBe("first stream\n");
  });

  it("keeps a limit hit's wait going past its reset while cswap's reading is stale, announcing it once", async () => {
    addSpec([1]);
    let fiveHour = 0.5;
    let now = new Date("2026-10-12T10:00:00Z");
    const sleeps: number[] = [];
    const agentStep = FakeAgentStep.init(
      limitHitStep("stream\n", fiveHourHit, () => {
        fiveHour = 1;
      }),
      implemented("one.ts"),
      reviewed(),
    );

    const result = await specRun(agentStep, {
      usageReader: { read: async () => usageListOf(fiveHour, 0.5) },
      clock: { now: () => now },
      async sleep(ms) {
        sleeps.push(ms);
        now = new Date("2026-10-12T11:01:00Z");
        if (sleeps.length === 2) fiveHour = 0.1;
      },
    }).run(spec);

    expect(result.landed).toEqual([refOf(1)]);
    expect(sleeps).toEqual([60_000, 60_000]);
    expect(agentStep.requests[1]?.resumeSessionId).toBe("session");
    expect(
      noticeSummaries().filter((summary) => summary.startsWith("Limit wait")),
    ).toEqual([
      "Limit wait: account 1 hit its 5-hour limit; continuing after 2026-10-12 06:01:00 CDT. Switching to an account with headroom with cswap continues the run now.",
    ]);
  });

  it("counts a resolve step's limit resume in its ticket's facts file", async () => {
    addSpec([1]);
    const account = cappedAccount();
    const agentStep = FakeAgentStep.init(
      implemented("one.ts"),
      reviewed([findingOf({ line: 1 })]),
      limitHitStep("stream\n", fiveHourHit, account.hit),
      resolved(
        [
          {
            finding: 1,
            axis: "standards",
            where: "one.ts:1",
            claim: "Line 1 is wrong.",
            evidence: "Checked it.",
            verdict: "fix",
            quote: "one.ts:1 `export {};`",
            rule: "config/docs/code-style.md: a rule.",
          },
        ],
        "fix.ts",
      ),
    );

    const result = await specRun(agentStep, account).run(spec);

    expect(result.kind).toBe("finished");
    expect(agentStep.requests).toHaveLength(4);
    expect(ticketFacts(1).limitResumes).toBe(1);
  });

  it("writes no limit resume for a ticket that met no limit", async () => {
    addSpec([1]);

    await specRun(FakeAgentStep.init(implemented("one.ts"), reviewed())).run(
      spec,
    );

    expect(ticketFacts(1).limitResumes).toBe(0);
  });

  it("waits out a weekly limit hit mid-step until its weekly reset and resumes the same session", async () => {
    addSpec([1]);
    const account = cappedAccount();
    const weeklyHit: LimitHit = {
      window: "sevenDay",
      resetsAt: new Date("2026-10-15T00:00:00Z"),
    };
    const agentStep = FakeAgentStep.init(
      limitHitStep("stream\n", weeklyHit, account.hit),
      implemented("one.ts"),
      reviewed(),
    );

    const result = await specRun(agentStep, account).run(spec);

    expect(result.landed).toEqual([refOf(1)]);
    expect(agentStep.requests[1]?.resumeSessionId).toBe("session");
    expect(noticeSummaries()).toContain(
      "Limit wait: account 1 hit its weekly limit; continuing after 2026-10-14 19:01:00 CDT. Switching to an account with headroom with cswap continues the run now.",
    );
  });

  it("warns once on a limit error with no reset, waits until the account reads under its thresholds and resumes", async () => {
    addSpec([1]);
    const account = cappedAccount();
    const agentStep = FakeAgentStep.init(
      limitHitStep(
        "bare 429\n",
        { window: undefined, resetsAt: undefined },
        account.hit,
      ),
      implemented("one.ts"),
      reviewed(),
    );

    const result = await specRun(agentStep, account).run(spec);

    expect(result.landed).toEqual([refOf(1)]);
    expect(account.sleeps).toEqual([60_000, 60_000, 60_000]);
    expect(agentStep.requests[1]?.resumeSessionId).toBe("session");
    expect(noticeSummaries().slice(0, 3)).toEqual([
      "Run started on 1 tickets as account 1: 5-hour 50%, weekly 50%. Launching byro-repo #1.",
      "Unrecognised limit error on account 1; the saved stream can tighten detection.",
      "Limit wait: account 1 hit a limit error with no reset; continuing once the Active account reads under its thresholds. Switching to an account with headroom with cswap continues the run now.",
    ]);
    expect(savedLimitHit()).toBe("bare 429\n");
  });

  it("resumes a step a limit cut off on the account cswap switched to, at the next poll", async () => {
    addSpec([1]);
    let activeAccount = 1;
    let account1FiveHour = 0.5;
    const usageReader: UsageReader = {
      read: async () => ({
        ...usageListOf(account1FiveHour, 0.5),
        activeAccount,
      }),
    };
    const sleeps: number[] = [];
    const agentStep = FakeAgentStep.init(
      limitHitStep("stream\n", fiveHourHit, () => {
        account1FiveHour = 1;
      }),
      implemented("one.ts"),
      reviewed(),
    );

    const result = await specRun(agentStep, {
      usageReader,
      async sleep(ms) {
        sleeps.push(ms);
        activeAccount = 2;
      },
    }).run(spec);

    expect(result.landed).toEqual([refOf(1)]);
    expect(sleeps).toEqual([60_000]);
    expect(
      agentStep.requests.map(({ account, resumeSessionId }) => ({
        account,
        resumeSessionId,
      })),
    ).toEqual([
      { account: 1, resumeSessionId: undefined },
      { account: 2, resumeSessionId: "session" },
      { account: 2, resumeSessionId: undefined },
    ]);
  });

  it("gives a crash after a limit resume its own retry", async () => {
    addSpec([1]);
    const account = cappedAccount();
    const agentStep = FakeAgentStep.init(
      limitHitStep("stream\n", fiveHourHit, account.hit),
      crashed,
      implemented("one.ts"),
      reviewed(),
    );

    const result = await specRun(agentStep, account).run(spec);

    expect(result.landed).toEqual([refOf(1)]);
    expect(agentStep.requests[2]?.resumeSessionId).toBe("crashed-session");
  });

  it("holds a step while the last step's stream reads past the 5-hour line in cswap's window, and launches once cswap's reset moves on", async () => {
    addSpec([1]);
    let fiveHourReset = new Date("2026-10-12T11:00:00Z");
    const usageReader: UsageReader = {
      read: async () => {
        const list = usageListOf(0.9, 0.5);
        const [account1] = list.readings;
        if (account1?.usage !== undefined) {
          account1.usage.fiveHour.resetsAt = fiveHourReset;
        }
        return list;
      },
    };
    const sleeps: number[] = [];
    const streamRead95 = async (request: StepRequest): Promise<StepResult> => ({
      ...(await implemented("one.ts")(request)),
      usage: {
        fiveHour: {
          utilization: 0.95,
          resetsAt: new Date("2026-10-12T11:00:00Z"),
        },
        sevenDay: undefined,
      },
    });
    const agentStep = FakeAgentStep.init(streamRead95, reviewed());

    const result = await specRun(agentStep, {
      usageReader,
      async sleep(ms) {
        sleeps.push(ms);
        if (sleeps.length === 2) {
          fiveHourReset = new Date("2026-10-12T16:00:00Z");
        }
      },
    }).run(spec);

    expect(result.landed).toEqual([refOf(1)]);
    expect(sleeps).toEqual([60_000, 60_000]);
    expect(noticeSummaries()).toContain(
      "Limit wait: account 1 is at 95% of its 5-hour limit; continuing after 2026-10-12 06:01:00 CDT. Switching to an account with headroom with cswap continues the run now.",
    );
  });

  it("waits out a limit hit on the gap check and resumes its session, counting it on no ticket", async () => {
    addSpec([1]);
    const account = cappedAccount();
    const agentStep = FakeAgentStep.init(
      implemented("one.ts"),
      reviewed(),
      limitHitStep("stream\n", fiveHourHit, account.hit),
      resultOf({ gaps: [] }),
    );

    const result = await specRun(agentStep, { ...account, agentStep }).run(
      spec,
    );

    expect(result.kind).toBe("finished");
    expect(requestsOf(agentStep)[3]).toEqual({
      account: 1,
      resumeSessionId: "session",
      prompt: limitResumePrompt,
    });
    expect(ticketFacts(1).limitResumes).toBe(0);
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
      "Run started on 2 tickets as account 1: no usage reading. Launching byro-repo #1.",
      "No usage reading for account 1; steps launch unguarded.",
      result.message,
    ]);
  });

  it("lands a step that met a limit but still succeeded", async () => {
    addSpec([1]);
    const hit: LimitHit = { window: "fiveHour", resetsAt: undefined };

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
      "Run started on 1 tickets as account 1: 5-hour 10%, weekly 20%. Launching byro-repo #1.",
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
      "Run started on 1 tickets as account 1: 5-hour 10%, weekly 20%. Launching byro-repo #1.",
      "byro-repo #1: workspace took 4s.",
      "byro-repo #1: implement took 60s.",
      "byro-repo #1: review took 20s.",
    ]);
  });
});
