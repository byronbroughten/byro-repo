import { describe, expect, it } from "vitest";

import type { Pair, StepResult } from "./AgentStep.ts";
import { FakeAgentStep } from "./FakeAgentStep.ts";
import { guidanceSectionOf } from "./halts.ts";
import { runKnobsOf } from "./runKnobs.ts";
import {
  addSpec,
  capped,
  clonePaths,
  crashed,
  github,
  greenUnlessRed,
  haltComments,
  implemented,
  noticeSummaries,
  passes,
  resultOf,
  reviewed,
  spec,
  specRun,
  useSpecRunHarness,
} from "./specRunHarness.ts";

useSpecRunHarness();

const noGaps = resultOf({ gaps: [] });

const unmatched: StepResult = {
  ...resultOf(undefined),
  output: {
    status: "schemaFailure",
    rawOutput: '{"gaps":"none"}',
    problems: ["gaps must be an array"],
  },
};

function gapCheckLists(): string[] {
  return github.comments
    .map(({ body }) => body)
    .filter((body) => body.includes("<!-- review-list ticket=gap-check -->"));
}

// Lands ticket 1, then scripts the gap check's own launches.
function landsThenGapChecks(...gapChecks: StepResult[]): FakeAgentStep {
  return FakeAgentStep.init(implemented("one.ts"), reviewed(), ...gapChecks);
}

async function runGapChecks(
  ...gapChecks: StepResult[]
): Promise<FakeAgentStep> {
  const agentStep = FakeAgentStep.init(...gapChecks);
  await specRun(agentStep, { agentStep }).run(spec);
  return agentStep;
}

async function haltsOnGapCheck(): Promise<void> {
  addSpec([1]);
  const agentStep = landsThenGapChecks(capped, capped);
  await specRun(agentStep, { agentStep }).run(spec);
}

describe("run's gap-check failures", () => {
  it("retries a turn-capped gap check once fresh, then posts a Failure Halt on the spec issue and idles", async () => {
    addSpec([1]);
    const agentStep = landsThenGapChecks(capped, capped);

    const result = await specRun(agentStep, { agentStep }).run(spec);

    const gapChecks = agentStep.requests.slice(2);
    expect(gapChecks).toHaveLength(2);
    expect(gapChecks[1]?.resumeSessionId).toBeUndefined();
    expect(gapChecks[1]?.prompt).toBe(gapChecks[0]?.prompt);
    const [halt] = haltComments();
    expect(halt).toContain(
      '**Halt H1** · Halt 1 of 1 · byro-repo #213, "The spec" · Failure Halt',
    );
    expect(halt).toContain("The gap check step hit its 80-turn cap.");
    expect(noticeSummaries()).toContain(
      "Idle: nothing runnable. The gap check waits on Halt H1.",
    );
    expect(result.kind).toBe("stopped");
    expect(result.landed).toHaveLength(1);
    expect(gapCheckLists()).toEqual([]);
  });

  it("posts the gap check's list when its fresh retry finishes", async () => {
    addSpec([1]);
    const agentStep = landsThenGapChecks(capped, noGaps);

    const result = await specRun(agentStep, { agentStep }).run(spec);

    expect(result.kind).toBe("finished");
    expect(haltComments()).toEqual([]);
    expect(gapCheckLists()).toHaveLength(1);
  });

  it("posts a Failure Halt at once for a gap-check output that fails its schema, linking the raw output", async () => {
    addSpec([1]);
    const agentStep = landsThenGapChecks(unmatched);

    await specRun(agentStep, { agentStep }).run(spec);

    expect(agentStep.requests).toHaveLength(3);
    const [halt] = haltComments();
    expect(halt).toContain("Failure Halt");
    expect(halt).toContain("gaps must be an array");
    expect(halt).toContain("gap-check.output.txt");
  });

  it("keeps the Stop for a gap check that crashes", async () => {
    addSpec([1]);
    const agentStep = landsThenGapChecks(crashed);

    const result = await specRun(agentStep, { agentStep }).run(spec);

    expect(result.kind).toBe("stopped");
    expect(result.message).toContain("The gap check stopped on a step error");
    expect(haltComments()).toEqual([]);
  });

  it("never counts a gap-check Halt toward the stuck detector", async () => {
    addSpec([1]);
    const agentStep = landsThenGapChecks(unmatched);
    const knobs = runKnobsOf({
      clonePaths,
      checks: [greenUnlessRed],
      authChecks: [passes],
      stuckFailureHalts: 1,
    });

    const result = await specRun(agentStep, { agentStep, knobs }).run(spec);

    expect(result.message).not.toContain("Stopped as stuck");
    expect(noticeSummaries()).toContain(
      "Idle: nothing runnable. The gap check waits on Halt H1.",
    );
  });

  it("reruns the gap check in the same run once a later poll reads the Halt's answer", async () => {
    addSpec([1]);
    const agentStep = landsThenGapChecks(capped, capped, noGaps);

    const result = await specRun(agentStep, {
      agentStep,
      async sleep() {
        github.reply(213, "H1: retry");
      },
    }).run(spec);

    expect(result.kind).toBe("finished");
    expect(agentStep.requests).toHaveLength(5);
    expect(gapCheckLists()).toHaveLength(1);
  });
});

describe("run's gap-check Failure Halt answers", () => {
  const guidance = "Read the spec's addendum first.";

  it("ends the run without a gap check on a `skip` answer", async () => {
    await haltsOnGapCheck();
    github.reply(213, "H1: skip");

    const agentStep = await runGapChecks();

    expect(agentStep.requests).toEqual([]);
    expect(noticeSummaries().at(-1)).toBe(
      "Run ended: landed nothing. Every ticket is closed.",
    );
    expect(gapCheckLists()).toEqual([]);
  });

  it("takes a `stop spec` answer as a `skip` on the rerun", async () => {
    await haltsOnGapCheck();
    github.reply(213, "H1: stop spec");
    const stopped = await specRun(FakeAgentStep.init()).run(spec);
    expect(stopped.message).toContain("Stopped on `stop spec` for Halt H1");

    const agentStep = await runGapChecks();

    expect(agentStep.requests).toEqual([]);
    expect(gapCheckLists()).toEqual([]);
  });

  it("reruns the gap check on the pair a `rerun on <pair>` answer names", async () => {
    await haltsOnGapCheck();
    github.reply(213, "H1: rerun on Opus high");

    const agentStep = await runGapChecks(noGaps);

    expect(agentStep.requests[0]?.pair).toEqual<Pair>({
      model: "opus",
      effort: "high",
    });
    expect(gapCheckLists()).toHaveLength(1);
  });

  it("adds a guidance answer to the gap-check prompt, its turn-cap retry included", async () => {
    await haltsOnGapCheck();
    github.reply(213, `H1: ${guidance}`);

    const agentStep = await runGapChecks(capped, noGaps);

    const section = guidanceSectionOf(`H1: ${guidance}`);
    expect(agentStep.requests.map(({ prompt }) => prompt)).toEqual([
      expect.stringContaining(section),
      expect.stringContaining(section),
    ]);
    expect(gapCheckLists()).toHaveLength(1);
  });

  it("runs the gap check fresh on a `retry` answer, on its own pair and without guidance", async () => {
    await haltsOnGapCheck();
    github.reply(213, "H1: retry");

    const agentStep = await runGapChecks(noGaps);

    const [rerun] = agentStep.requests;
    expect(rerun?.pair).toEqual<Pair>({ model: "opus", effort: "medium" });
    expect(rerun?.resumeSessionId).toBeUndefined();
    expect(rerun?.prompt).not.toContain("The developer's guidance");
    expect(gapCheckLists()).toHaveLength(1);
  });

  it("acts on an answer once, a later Halt's answer replacing it", async () => {
    await haltsOnGapCheck();
    github.reply(213, "H1: rerun on Opus high");
    await runGapChecks(capped, capped);
    github.reply(213, "H2: retry");

    const agentStep = await runGapChecks(noGaps);

    expect(agentStep.requests[0]?.pair).toEqual<Pair>({
      model: "opus",
      effort: "medium",
    });
  });
});
