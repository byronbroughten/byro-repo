import { describe, expect, it } from "vitest";

import { FakeAgentStep } from "./FakeAgentStep.ts";
import type { Blocker } from "./implementStep.ts";
import type { RunResult } from "./SpecRun.ts";
import {
  addSpec,
  blocked,
  github,
  implemented,
  notices,
  reviewed,
  spec,
  specRun,
  ticketState,
  useSpecRunHarness,
} from "./specRunHarness.ts";

useSpecRunHarness();

describe("run's idle and stops", () => {
  const gated: Blocker = {
    kind: "gated-action",
    detail: "It needs app:build.",
    recommendation: "Run it by hand.",
  };
  const ambiguous: Blocker = {
    kind: "spec-ambiguity",
    detail: "The spec reads both ways.",
    recommendation: "Read it the first way.",
  };

  function summaries(): string[] {
    return notices.sent.map(({ summary }) => summary);
  }

  it("ends after the current ticket on a stop request, leaving the next ticket unlaunched", async () => {
    addSpec([1, 2]);
    const agentStep = FakeAgentStep.init(
      implemented("one.ts", { act: () => run.requestStop(spec) }),
      reviewed(),
    );
    const run = specRun(agentStep);

    const result = await run.run(spec);

    expect(result).toEqual<RunResult>({
      kind: "stopped",
      landed: [{ repo: "byro-repo", number: 1 }],
      message: "Stopped on request: landed byro-repo #1.",
    });
    expect(agentStep.requests).toHaveLength(2);
    expect(github.issues.get(2)?.isOpen).toBe(true);
    expect(summaries().at(-1)).toBe(result.message);
  });

  it("drops a stop request left from before the run", async () => {
    addSpec([1]);
    specRun(FakeAgentStep.init()).requestStop(spec);

    const result = await specRun(
      FakeAgentStep.init(implemented("one.ts"), reviewed()),
    ).run(spec);

    expect(result.kind).toBe("finished");
  });

  it("goes idle with one push while a Halt is open, then lands the ticket once a later poll reads its answer", async () => {
    addSpec([1]);
    let polls = 0;
    const agentStep = FakeAgentStep.init(
      blocked([gated]),
      implemented("one.ts"),
      reviewed(),
    );

    const result = await specRun(agentStep, {
      async sleep() {
        polls += 1;
        if (polls === 2) github.reply(213, "H1: I ran it.");
      },
    }).run(spec);

    expect(polls).toBe(2);
    expect(result.message).toBe(
      "Run ended: landed byro-repo #1. Every ticket is closed.",
    );
    expect(summaries().filter((line) => line.startsWith("Idle:"))).toEqual([
      "Idle: nothing runnable. byro-repo #1 waits on Halt H1.",
    ]);
  });

  it("ends on a `stop spec` answer, the halted ticket unlanded and its other Halt open", async () => {
    addSpec([1, 2]);
    github.blockers.set(2, [1]);
    const agentStep = FakeAgentStep.init(blocked([gated, ambiguous]));
    const run = specRun(agentStep, {
      async sleep() {
        github.reply(213, "H1: stop spec");
      },
    });

    const result = await run.run(spec);

    expect(result).toEqual<RunResult>({
      kind: "stopped",
      landed: [],
      message:
        "Stopped on `stop spec` for Halt H1: landed nothing; byro-repo #1 stays unlanded.",
    });
    expect(summaries().at(-1)).toBe(result.message);
    expect(ticketState()["byro-repo #1"]?.step).toBe("halted");
    expect(github.issues.get(1)?.isOpen).toBe(true);
    expect(agentStep.requests).toHaveLength(1);
    expect(await run.status(spec)).toContain("Open Halts: H2 on byro-repo #1.");
  });

  it("ends naming the developer's ticket, what it blocks, and the rerun command", async () => {
    addSpec([1, 2, 3]);
    github.edit(1, { labels: ["ready-for-human"] });
    github.blockers.set(2, [1]);

    const result = await specRun(
      FakeAgentStep.init(implemented("three.ts"), reviewed()),
    ).run(spec);

    expect(result.kind).toBe("finished");
    expect(summaries().at(-1)).toBe(
      "Run ended: landed byro-repo #3. byro-repo #1 waits on you and blocks byro-repo #2; byro-repo #2 is blocked by byro-repo #1. Rerun once your tickets close: `npm run runner -- byronbroughten/byro-repo 213`.",
    );
  });

  it("names the rerun command on a stop request while a ticket waits on the developer", async () => {
    addSpec([1, 2]);
    github.edit(2, { labels: ["ready-for-human"] });

    const result = await specRun(FakeAgentStep.init(blocked([gated]))).run(
      spec,
    );

    expect(result.message).toBe(
      "Stopped on request: landed nothing. byro-repo #1 waits on Halt H1; byro-repo #2 waits on you. Rerun once your tickets close: `npm run runner -- byronbroughten/byro-repo 213`.",
    );
  });

  it("prints a status from run state and GitHub", async () => {
    addSpec([1, 2, 3]);
    github.edit(3, { labels: ["ready-for-human"] });
    const run = specRun(
      FakeAgentStep.init(blocked([gated]), implemented("two.ts"), reviewed()),
    );
    await run.run(spec);
    run.requestStop(spec);

    expect(await run.status(spec)).toBe(
      [
        'byro-repo #213, "The spec"',
        "Landed: byro-repo #2.",
        "Current: none.",
        "Open Halts: H1 on byro-repo #1.",
        "Waiting: byro-repo #1 waits on Halt H1; byro-repo #3 waits on you.",
        "Account: account 1: 5-hour 10%, weekly 20%.",
        "A stop is requested; the run ends after its current ticket.",
      ].join("\n"),
    );
  });
});
