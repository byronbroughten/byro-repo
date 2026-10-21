import { copyFileSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import type { StepRequest, StepResult } from "./AgentStep.ts";
import { FakeAgentStep } from "./FakeAgentStep.ts";
import { git } from "./GitFixture.ts";
import {
  addSpec,
  after,
  bodyWith,
  crashed,
  eventOf,
  github,
  greened,
  haltComments,
  implemented,
  masterSubjects,
  primaryOf,
  progressLines,
  readingOf,
  refOf,
  resultOf,
  reviewed,
  scriptUsage,
  spec,
  specRun,
  stateFolder,
  throws,
  ticketState,
  timed,
  useSpecRunHarness,
} from "./specRunHarness.ts";

useSpecRunHarness();

function runStatePath(): string {
  return join(stateFolder(), "byro-repo-213.run.json");
}

describe("run's crash retries", () => {
  it("saves a crashed implement step's uncommitted work to a backup branch, resets the tree and resumes the session", async () => {
    addSpec([1]);
    let statusAtRetry: string | undefined;
    let branch = "";
    const agentStep = FakeAgentStep.init(
      async (request) => {
        writeFileSync(join(request.cwd, "half.ts"), "half a change\n");
        return crashed;
      },
      async (request) => {
        statusAtRetry = git(request.cwd, "status", "--porcelain");
        branch = git(request.cwd, "branch", "--show-current");
        return implemented("one.ts")(request);
      },
      reviewed(),
    );

    const result = await specRun(agentStep).run(spec);

    expect(result.landed).toEqual([refOf(1)]);
    expect(statusAtRetry).toBe("");
    expect(
      git(primaryOf("byro-repo"), "show", `backup/${branch}-implement:half.ts`),
    ).toBe("half a change");
    const retry = agentStep.requests[1];
    expect(retry?.resumeSessionId).toBe("crashed-session");
    expect(retry?.prompt).toMatch(
      /^The previous run was interrupted; continue/,
    );
    const facts = JSON.parse(
      readFileSync(join(stateFolder(), "byro-repo-1.facts.json"), "utf8"),
    ) as { retries: number };
    expect(facts.retries).toBe(1);
  });

  it("relaunches a step whose adapter throws with the same prompt and no session", async () => {
    addSpec([1]);
    const agentStep = FakeAgentStep.init(
      throws("spawn claude ENOENT"),
      implemented("one.ts"),
      reviewed(),
    );

    const result = await specRun(agentStep).run(spec);

    expect(result.landed).toEqual([refOf(1)]);
    const [first, retry] = agentStep.requests;
    expect(retry?.prompt).toBe(first?.prompt);
    expect(retry?.resumeSessionId).toBeUndefined();
    expect(progressLines().map(eventOf)).toContain(
      "byro-repo #1: The implement step failed to run: spawn claude ENOENT Retrying, 1 of 1.",
    );
  });

  it("passes the hang limits on each request and retries a step killed for silence", async () => {
    addSpec([1]);
    const hung: StepResult = {
      ...crashed,
      exitSubtype: undefined,
      hang: "silence",
    };
    const agentStep = FakeAgentStep.init(
      implemented("one.ts"),
      after(600, hung),
      reviewed(),
    );

    const result = await specRun(agentStep, timed()).run(spec);

    expect(result.landed).toEqual([refOf(1)]);
    const limits = agentStep.requests.map(
      ({ silenceTimeoutMs, wallClockMs }: StepRequest) => ({
        silenceTimeoutMs,
        wallClockMs,
      }),
    );
    expect(limits).toEqual([
      { silenceTimeoutMs: 600_000, wallClockMs: 3_600_000 },
      { silenceTimeoutMs: 600_000, wallClockMs: 1_200_000 },
      { silenceTimeoutMs: 600_000, wallClockMs: 1_200_000 },
    ]);
    expect(progressLines().map(eventOf)).toContain(
      "byro-repo #1: The review step was silent for 10 minutes and was killed. Retrying, 1 of 1.",
    );
    expect(agentStep.requests[2]?.prompt).not.toContain("backup branch");
  });

  it("retries a step killed at its wall clock", async () => {
    addSpec([1]);
    const hung: StepResult = {
      ...crashed,
      exitSubtype: undefined,
      hang: "wall-clock",
    };
    const agentStep = FakeAgentStep.init(
      after(3_600, hung),
      implemented("one.ts"),
      reviewed(),
    );

    const result = await specRun(agentStep, timed()).run(spec);

    expect(result.landed).toEqual([refOf(1)]);
    expect(progressLines().map(eventOf)).toContain(
      "byro-repo #1: The implement step ran past its 60-minute wall clock and was killed. Retrying, 1 of 1.",
    );
  });

  it("posts a Failure Halt on a second crash, and a `retry` answer runs the step again and lands", async () => {
    addSpec([1]);
    await specRun(FakeAgentStep.init(crashed, crashed)).run(spec);

    expect(ticketState()["byro-repo #1"]?.step).toBe("halted");
    const [halt] = haltComments();
    expect(haltComments()).toHaveLength(1);
    expect(halt).toContain("Failure Halt");
    expect(halt).toContain("The implement step ended error_during_execution.");
    expect(halt).toContain(
      `Log: \`${join(stateFolder(), "byro-repo-213-steps", "byro-repo-1-2-implement.jsonl")}\``,
    );
    github.reply(213, "H1: retry");
    const rerunStep = FakeAgentStep.init(
      crashed,
      implemented("one.ts"),
      reviewed(),
    );

    const result = await specRun(rerunStep).run(spec);

    expect(result.landed).toEqual([refOf(1)]);
    expect(rerunStep.requests[0]?.prompt).toContain("implement");
    expect(rerunStep.requests[0]?.resumeSessionId).toBeUndefined();
  });
});

describe("run's red-check resume", () => {
  it("resumes the implementer that made the last commit with the failing check", async () => {
    addSpec([1]);
    const agentStep = FakeAgentStep.init(
      async (request) => ({
        ...(await implemented("RED")(request)),
        peakContext: 90_000,
      }),
      reviewed(),
      greened(),
    );

    const result = await specRun(agentStep).run(spec);

    expect(result.landed).toEqual([refOf(1)]);
    const resumed = agentStep.requests[2];
    expect(resumed?.resumeSessionId).toBe("session");
    expect(resumed?.prompt).toContain(
      "node -e process.exit(require('fs').existsSync('RED') ? 1 : 0) failed",
    );
  });

  it("hands red checks to the triage agent on the stronger pair once the implementer is past the ticket budget", async () => {
    addSpec([1]);
    github.edit(1, { body: bodyWith("Sonnet medium") });
    const agentStep = FakeAgentStep.init(
      async (request) => ({
        ...(await implemented("RED")(request)),
        peakContext: 160_000,
      }),
      reviewed(),
      greened(),
    );

    const result = await specRun(agentStep).run(spec);

    expect(result.landed).toEqual([refOf(1)]);
    const resumed = agentStep.requests[2];
    expect(resumed?.pair).toEqual({ model: "opus", effort: "medium" });
    expect(resumed?.resumeSessionId).toBeUndefined();
  });

  it("posts a Failure Halt linking the resume's log when the checks stay red, leaving the branch unlanded", async () => {
    addSpec([1]);
    const agentStep = FakeAgentStep.init(
      implemented("RED"),
      reviewed(),
      resultOf({ summary: "Tried." }),
    );

    await specRun(agentStep).run(spec);

    const [halt] = haltComments();
    expect(halt).toContain("Failure Halt");
    expect(halt).toContain("The checks are still red after 1 resume(s)");
    expect(halt).toContain(
      `Log: \`${join(stateFolder(), "byro-repo-213-steps", "byro-repo-1-3-fix.jsonl")}\``,
    );
    expect(masterSubjects()).not.toContain("Add RED");
    expect(github.issues.get(1)?.isOpen).toBe(true);
  });
});

describe("run's retries across a rerun", () => {
  it("takes a step the dead run left started as its first crash and retries it", async () => {
    addSpec([1]);
    const saved = join(stateFolder(), "saved.run.json");
    await specRun(
      FakeAgentStep.init(async () => {
        copyFileSync(runStatePath(), saved);
        throw new Error("killed");
      }, crashed),
    ).run(spec);
    copyFileSync(saved, runStatePath());

    const result = await specRun(
      FakeAgentStep.init(implemented("one.ts"), reviewed()),
    ).run(spec);

    expect(result.landed).toEqual([refOf(1)]);
    expect(progressLines().map(eventOf)).toContain(
      "byro-repo #1: The run ended during the implement step. Retrying, 1 of 1.",
    );
  });

  it("takes a step the dead run left started as a crash with the carried count", async () => {
    addSpec([1]);
    const saved = join(stateFolder(), "saved.run.json");
    await specRun(
      FakeAgentStep.init(crashed, async () => {
        copyFileSync(runStatePath(), saved);
        throw new Error("killed");
      }),
    ).run(spec);
    copyFileSync(saved, runStatePath());
    const rerunStep = FakeAgentStep.init();

    await specRun(rerunStep).run(spec);

    expect(rerunStep.requests).toEqual([]);
    expect(haltComments().at(-1)).toContain(
      "The run ended during the implement step.",
    );
  });

  it("keeps the retry for a rerun after a weekly-reserve Stop at a launch", async () => {
    addSpec([1]);
    scriptUsage(readingOf(0.1, 0.2), readingOf(0.1, 0.2), readingOf(0.3, 0.96));
    const first = await specRun(FakeAgentStep.init(implemented("one.ts"))).run(
      spec,
    );
    expect(first.kind).toBe("stopped");
    scriptUsage(readingOf(0.1, 0.2));

    const result = await specRun(FakeAgentStep.init(crashed, reviewed())).run(
      spec,
    );

    expect(result.landed).toEqual([refOf(1)]);
  });
});

describe("run's Stop wording", () => {
  it("tells the developer a rerun won't retry a step error", async () => {
    addSpec([1]);
    const errored: StepResult = {
      ...resultOf(undefined),
      output: { status: "none" },
      exitSubtype: "error_max_budget_usd",
    };

    const result = await specRun(FakeAgentStep.init(errored)).run(spec);

    expect(result.message).toBe("Stopped on byro-repo #1: a step error.");
    expect(github.comments[0]?.body).toContain(
      "a rerun won't retry it. Finish and land it by hand",
    );
    expect(github.comments[0]?.body).not.toContain("rerun to retry");
  });
});
