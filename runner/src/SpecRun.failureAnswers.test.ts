import { describe, expect, it } from "vitest";

import type { Pair, StepResult } from "./AgentStep.ts";
import { FakeAgentStep } from "./FakeAgentStep.ts";
import { guidanceSectionOf } from "./halts.ts";
import type { Blocker } from "./implementStep.ts";
import type { RunResult } from "./SpecRun.ts";
import {
  addSpec,
  blocked,
  bodyWith,
  github,
  haltComments,
  implemented,
  notices,
  refOf,
  resultOf,
  reviewed,
  spec,
  specRun,
  type StepScript,
  ticketState,
  useSpecRunHarness,
} from "./specRunHarness.ts";

useSpecRunHarness();

const crashed: StepResult = {
  ...resultOf(undefined),
  output: { status: "none" },
  sessionId: "crashed-session",
  exitSubtype: "error_during_execution",
};

const capped: StepResult = {
  ...resultOf(undefined),
  output: { status: "none" },
  sessionId: "capped-session",
  exitSubtype: "error_max_turns",
};

const opusHigh: Pair = { model: "opus", effort: "high" };

function throws(message: string): StepScript {
  return async () => {
    throw new Error(message);
  };
}

function summaries(): string[] {
  return notices.sent.map(({ summary }) => summary);
}

describe("run's Failure Halt answers", () => {
  const guidance = "Split the change into two commits.";

  it("ends on a `stop spec` answer to a Failure Halt, the ticket unlanded", async () => {
    addSpec([1]);
    const agentStep = FakeAgentStep.init(crashed, crashed);

    const result = await specRun(agentStep, {
      async sleep() {
        github.reply(213, "H1: stop spec");
      },
    }).run(spec);

    expect(result).toEqual<RunResult>({
      kind: "stopped",
      landed: [],
      message:
        "Stopped on `stop spec` for Halt H1: landed nothing; byro-repo #1 stays unlanded.",
    });
    expect(agentStep.requests).toHaveLength(2);
    expect(github.issues.get(1)?.isOpen).toBe(true);
  });

  it("keeps a `rerun on <pair>` pair for a later `retry`", async () => {
    addSpec([1]);
    github.edit(1, { body: bodyWith("Opus medium") });
    await specRun(FakeAgentStep.init(capped)).run(spec);
    github.reply(213, "H1: rerun on Opus high");
    await specRun(FakeAgentStep.init(crashed, crashed)).run(spec);
    github.reply(213, "H2: retry");
    const rerunStep = FakeAgentStep.init(implemented("one.ts"), reviewed());

    const result = await specRun(rerunStep).run(spec);

    expect(result.landed).toEqual([refOf(1)]);
    expect(rerunStep.requests[0]?.pair).toEqual(opusHigh);
    expect(rerunStep.requests[0]?.resumeSessionId).toBeUndefined();
  });

  it("adds a guidance answer to the halted step's next launch and its crash retry, then to no later step", async () => {
    addSpec([1]);
    await specRun(FakeAgentStep.init(crashed, crashed)).run(spec);
    github.reply(213, `H1: ${guidance}`);
    const rerunStep = FakeAgentStep.init(
      throws("The adapter broke."),
      implemented("one.ts"),
      reviewed(),
    );

    const result = await specRun(rerunStep).run(spec);

    expect(result.landed).toEqual([refOf(1)]);
    const [first, retried, review] = rerunStep.requests;
    const section = guidanceSectionOf(`H1: ${guidance}`);
    expect(first?.prompt).toContain(section);
    expect(retried?.prompt).toContain(section);
    expect(review?.prompt).not.toContain(guidance);
  });

  it("drops a `skip` answered ticket from the run, open with its downstream blocked, and a later run retries it", async () => {
    addSpec([1, 2]);
    github.blockers.set(2, [1]);
    const agentStep = FakeAgentStep.init(crashed, crashed);

    const first = await specRun(agentStep, {
      async sleep() {
        github.reply(213, "H1: skip");
      },
    }).run(spec);

    expect(first.landed).toEqual([]);
    expect(agentStep.requests).toHaveLength(2);
    expect(github.issues.get(1)?.isOpen).toBe(true);
    expect(summaries().at(-1)).toContain("byro-repo #1 was skipped");
    expect(summaries().at(-1)).toContain(
      "byro-repo #2 is blocked by byro-repo #1",
    );
    const rerunStep = FakeAgentStep.init(
      implemented("one.ts"),
      reviewed(),
      implemented("two.ts"),
      reviewed(),
    );

    const rerun = await specRun(rerunStep).run(spec);

    expect(rerun.landed).toEqual([refOf(1), refOf(2)]);
    expect(rerunStep.requests[0]?.resumeSessionId).toBeUndefined();
  });
});

describe("run's stuck detector", () => {
  const gated: Blocker = {
    kind: "gated-action",
    detail: "It needs app:build.",
    recommendation: "Run it by hand.",
  };

  it("Stops with a push on Failure Halts on two different tickets in a row, both posted", async () => {
    addSpec([1, 2, 3]);
    const agentStep = FakeAgentStep.init(crashed, crashed, crashed, crashed);

    const result = await specRun(agentStep).run(spec);

    expect(result).toEqual<RunResult>({
      kind: "stopped",
      landed: [],
      message:
        "Stopped as stuck: byro-repo #1, byro-repo #2 each ended on a Failure Halt in a row; answer them, then rerun.",
    });
    expect(summaries().at(-1)).toBe(result.message);
    expect(haltComments()).toHaveLength(2);
    expect(ticketState()["byro-repo #2"]?.step).toBe("halted");
    expect(agentStep.requests).toHaveLength(4);
  });

  it("resets the count on a landing between Failure Halts", async () => {
    addSpec([1, 2, 3]);
    const agentStep = FakeAgentStep.init(
      crashed,
      crashed,
      implemented("two.ts"),
      reviewed(),
      crashed,
      crashed,
    );

    const result = await specRun(agentStep).run(spec);

    expect(result.landed).toEqual([refOf(2)]);
    expect(result.message).not.toContain("stuck");
    expect(ticketState()["byro-repo #3"]?.step).toBe("halted");
  });

  it("leaves decision Halts out of the count", async () => {
    addSpec([1, 2]);
    const agentStep = FakeAgentStep.init(blocked([gated]), crashed, crashed);

    const result = await specRun(agentStep).run(spec);

    expect(result.message).not.toContain("stuck");
    expect(haltComments()).toHaveLength(2);
    expect(ticketState()["byro-repo #2"]?.step).toBe("halted");
  });
});
