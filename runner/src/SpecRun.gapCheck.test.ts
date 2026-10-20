import { describe, expect, it } from "vitest";

import type { Pair, StepResult } from "./AgentStep.ts";
import { FakeAgentStep } from "./FakeAgentStep.ts";
import { guidanceSectionOf } from "./halts.ts";
import { runKnobsOf } from "./runKnobs.ts";
import type { RunResult, SpecRunConfig } from "./SpecRun.ts";
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

interface LandedRun {
  result: RunResult;
  agentStep: FakeAgentStep;
}

// Lands ticket 1, then runs the gap check on the scripted launches.
async function landsThenGapChecks(
  gapChecks: StepResult[],
  overrides: Partial<SpecRunConfig> = {},
): Promise<LandedRun> {
  addSpec([1]);
  const agentStep = FakeAgentStep.init(
    implemented("one.ts"),
    reviewed(),
    ...gapChecks,
  );
  const result = await specRun(agentStep, { agentStep, ...overrides }).run(
    spec,
  );
  return { result, agentStep };
}

async function runGapChecks(
  ...gapChecks: StepResult[]
): Promise<FakeAgentStep> {
  const agentStep = FakeAgentStep.init(...gapChecks);
  await specRun(agentStep, { agentStep }).run(spec);
  return agentStep;
}

async function haltsOnGapCheck(): Promise<void> {
  await landsThenGapChecks([capped, capped]);
}

const idleOnH1 = "Idle: nothing runnable. The gap check waits on Halt H1.";

describe("run's gap-check failures", () => {
  it("retries a turn-capped gap check once fresh, then posts a Failure Halt on the spec issue", async () => {
    const { agentStep } = await landsThenGapChecks([capped, capped]);

    const [first, retry] = agentStep.requests.slice(2);
    expect(retry?.resumeSessionId).toBeUndefined();
    expect(retry?.prompt).toBe(first?.prompt);
    expect(haltComments()).toEqual([
      expect.stringContaining(
        '**Halt H1** · Halt 1 of 1 · byro-repo #213, "The spec" · Failure Halt\n\nThe gap check step hit its 80-turn cap.',
      ),
    ]);
  });

  it("idles while the gap check's Halt is open, posting no list", async () => {
    const { result } = await landsThenGapChecks([capped, capped]);

    expect(noticeSummaries()).toContain(idleOnH1);
    expect(result.kind).toBe("stopped");
    expect(gapCheckLists()).toEqual([]);
  });

  it("posts the gap check's list when its fresh retry finishes", async () => {
    const { result } = await landsThenGapChecks([capped, noGaps]);

    expect(result.kind).toBe("finished");
    expect(haltComments()).toEqual([]);
    expect(gapCheckLists()).toHaveLength(1);
  });

  it("posts a Failure Halt at once for a gap-check output that fails its schema, linking the raw output", async () => {
    // One launch: a schema failure is never retried.
    const { agentStep } = await landsThenGapChecks([unmatched]);

    expect(agentStep.requests).toHaveLength(3);
    const [halt] = haltComments();
    expect(halt).toContain(
      '**Halt H1** · Halt 1 of 1 · byro-repo #213, "The spec" · Failure Halt\n\ngaps must be an array',
    );
    expect(halt).toContain("gap-check.output.txt");
  });

  it("keeps the Stop for a gap check that crashes", async () => {
    const { result } = await landsThenGapChecks([crashed]);

    expect(result.kind).toBe("stopped");
    expect(result.message).toContain("The gap check stopped on a step error");
    expect(haltComments()).toEqual([]);
  });

  it("never counts a gap-check Halt toward the stuck detector", async () => {
    const knobs = runKnobsOf({
      clonePaths,
      checks: [greenUnlessRed],
      authChecks: [passes],
      stuckFailureHalts: 1,
    });

    const { result } = await landsThenGapChecks([unmatched], { knobs });

    expect(result.message).not.toContain("Stopped as stuck");
    expect(noticeSummaries()).toContain(idleOnH1);
  });

  it("reruns the gap check in the same run once a later poll reads the Halt's answer", async () => {
    const { result } = await landsThenGapChecks([capped, capped, noGaps], {
      async sleep() {
        github.reply(213, "H1: retry");
      },
    });

    expect(result.kind).toBe("finished");
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
