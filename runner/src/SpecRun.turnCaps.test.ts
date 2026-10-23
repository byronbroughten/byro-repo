import { writeFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import type { Pair, StepRequest, StepResult } from "./AgentStep.ts";
import { FakeAgentStep } from "./FakeAgentStep.ts";
import type { TriageRecord } from "./findingTriage.ts";
import { git } from "./GitFixture.ts";
import { moreTurnsPrompt } from "./implementStep.ts";
import {
  addSpec,
  bodyWith,
  capped,
  eventOf,
  findingOf,
  github,
  greened,
  haltComments,
  implemented,
  primaryOf,
  progressLines,
  refOf,
  resolved,
  reviewed,
  spec,
  specRun,
  ticketState,
  useSpecRunHarness,
} from "./specRunHarness.ts";

useSpecRunHarness();

describe("run's review and triage turn caps", () => {
  it("retries a review that hit its turn cap once, fresh", async () => {
    addSpec([1]);
    const agentStep = FakeAgentStep.init(
      implemented("one.ts"),
      capped,
      reviewed(),
    );

    const result = await specRun(agentStep).run(spec);

    expect(result.landed).toEqual([refOf(1)]);
    const [, first, retry] = agentStep.requests;
    expect(retry?.prompt).toBe(first?.prompt);
    expect(retry?.resumeSessionId).toBeUndefined();
    expect(progressLines().map(eventOf)).toContain(
      "byro-repo #1: The review step hit its 80-turn cap. Retrying, 1 of 1.",
    );
  });

  it("posts a Failure Halt when the review's retry hits its turn cap too", async () => {
    addSpec([1]);

    await specRun(
      FakeAgentStep.init(implemented("one.ts"), capped, capped),
    ).run(spec);

    expect(ticketState()["byro-repo #1"]?.step).toBe("halted");
    const [halt] = haltComments();
    expect(halt).toContain("Failure Halt");
    expect(halt).toContain("The review step hit its 80-turn cap.");
    expect(halt).toContain("1. `retry`");
  });
});

describe("run's implement turn cap", () => {
  const opusHigh: Pair = { model: "opus", effort: "high" };

  // Leaves an uncommitted edit, then runs out of turns.
  async function cappedMidEdit(request: StepRequest): Promise<StepResult> {
    writeFileSync(join(request.cwd, "half.ts"), "half a ticket\n");
    return capped;
  }

  it("snapshots and posts a Failure Halt offering more turns, a stronger pair and `stop spec`", async () => {
    addSpec([1]);
    github.edit(1, { body: bodyWith("Opus medium") });
    let branch = "";
    const agentStep = FakeAgentStep.init(async (request) => {
      branch = git(request.cwd, "branch", "--show-current");
      return cappedMidEdit(request);
    });

    await specRun(agentStep).run(spec);

    expect(agentStep.requests).toHaveLength(1);
    expect(ticketState()["byro-repo #1"]?.step).toBe("halted");
    expect(
      git(primaryOf("byro-repo"), "show", `backup/${branch}-implement:half.ts`),
    ).toBe("half a ticket");
    const [halt] = haltComments();
    expect(halt).toContain("Failure Halt");
    expect(halt).toContain("The implement step hit its 200-turn cap.");
    expect(halt).toContain("1. `resume +100 turns`");
    expect(halt).toContain("2. `rerun on Opus high`");
    expect(halt).toContain("`stop spec`");
    expect(halt).not.toContain("`retry`");
  });

  it("leaves `rerun on` out at the strongest pair", async () => {
    addSpec([1]);

    await specRun(FakeAgentStep.init(capped)).run(spec);

    const [halt] = haltComments();
    expect(halt).toContain("1. `resume +100 turns`");
    expect(halt).not.toContain("rerun on");
  });

  it("resumes the capped session with the answer's extra turns on `resume +N turns`", async () => {
    addSpec([1]);
    await specRun(FakeAgentStep.init(capped)).run(spec);
    github.reply(213, "H1: resume +50 turns");
    const rerunStep = FakeAgentStep.init(implemented("one.ts"), reviewed());

    const result = await specRun(rerunStep).run(spec);

    expect(result.landed).toEqual([refOf(1)]);
    const [resumed] = rerunStep.requests;
    expect(resumed?.resumeSessionId).toBe("capped-session");
    expect(resumed?.maxTurns).toBe(50);
    expect(resumed?.prompt).toBe(moreTurnsPrompt(50, true));
  });

  it("halts again on the extra turns' cap when the resumed session hits it", async () => {
    addSpec([1]);
    await specRun(FakeAgentStep.init(capped)).run(spec);
    github.reply(213, "H1: resume +50 turns");

    await specRun(FakeAgentStep.init(capped)).run(spec);

    expect(ticketState()["byro-repo #1"]?.step).toBe("halted");
    const halt = haltComments().at(-1);
    expect(halt).toContain("The implement step hit its 50-turn cap.");
    expect(halt).toContain("1. `resume +100 turns`");
  });

  it("reruns the step fresh on the named pair on `rerun on <pair>`", async () => {
    addSpec([1]);
    github.edit(1, { body: bodyWith("Opus medium") });
    await specRun(FakeAgentStep.init(capped)).run(spec);
    github.reply(213, "H1: rerun on Opus high");
    const rerunStep = FakeAgentStep.init(implemented("one.ts"), reviewed());

    const result = await specRun(rerunStep).run(spec);

    expect(result.landed).toEqual([refOf(1)]);
    const [rerun, review] = rerunStep.requests;
    expect(rerun?.pair).toEqual(opusHigh);
    expect(rerun?.resumeSessionId).toBeUndefined();
    expect(rerun?.maxTurns).toBe(200);
    expect(review?.pair).toEqual(opusHigh);
  });
});

describe("run's resolve and red-checks turn caps", () => {
  const findings = [findingOf(1), findingOf(2)];

  function fixRecordOf(finding: number): TriageRecord {
    return {
      finding,
      axis: "standards",
      where: `one.ts:${finding}`,
      claim: `Line ${finding} is wrong.`,
      evidence: "Checked it.",
      verdict: "fix",
      quote: `one.ts:${finding} \`export {};\``,
      rule: "config/docs/code-style.md: a rule.",
    };
  }

  // Commits one fix and leaves another half done, then runs out of turns.
  async function cappedFixer(request: StepRequest): Promise<StepResult> {
    writeFileSync(join(request.cwd, "fix.ts"), "export {};\n");
    git(request.cwd, "add", "fix.ts");
    git(request.cwd, "commit", "-m", "Fix fix.ts");
    writeFileSync(join(request.cwd, "half.ts"), "half a fix\n");
    return capped;
  }

  it("reruns a capped resolve with its work reset away, and lands the rerun's fix", async () => {
    addSpec([1]);
    const agentStep = FakeAgentStep.init(
      implemented("one.ts"),
      reviewed(findings),
      cappedFixer,
      resolved([fixRecordOf(1), fixRecordOf(2)], "fix.ts"),
    );

    const result = await specRun(agentStep).run(spec);

    expect(result.landed).toEqual([refOf(1)]);
    expect(agentStep.requests).toHaveLength(4);
    expect(progressLines().map(eventOf)).toContain(
      "byro-repo #1: The fix step hit its 120-turn cap. Retrying, 1 of 1.",
    );
    const primary = primaryOf("byro-repo");
    const merge = git(
      primary,
      "log",
      "--merges",
      "-1",
      "--format=%H",
      "master",
    );
    expect(
      git(primary, "log", "--format=%s", `${merge}^1..${merge}^2`).split("\n"),
    ).toEqual(["Fix fix.ts", "Add one.ts"]);
  });

  it("posts a Failure Halt when the resolve's rerun hits its turn cap too", async () => {
    addSpec([1]);

    await specRun(
      FakeAgentStep.init(
        implemented("one.ts"),
        reviewed(findings),
        cappedFixer,
        cappedFixer,
      ),
    ).run(spec);

    expect(ticketState()["byro-repo #1"]?.step).toBe("halted");
    const [halt] = haltComments();
    expect(halt).toContain("Failure Halt");
    expect(halt).toContain("The fix step hit its 120-turn cap.");
    expect(halt).toContain("1. `retry`");
  });

  it("lands a ticket whose red-checks resume turned the checks green before its turn cap", async () => {
    addSpec([1]);
    const agentStep = FakeAgentStep.init(
      implemented("RED"),
      reviewed(),
      async (request) => {
        await greened()(request);
        return capped;
      },
    );

    const result = await specRun(agentStep).run(spec);

    expect(result.landed).toEqual([refOf(1)]);
    expect(agentStep.requests).toHaveLength(3);
  });

  it("posts the checks' Failure Halt when the checks are still red after a capped resume", async () => {
    addSpec([1]);

    await specRun(
      FakeAgentStep.init(implemented("RED"), reviewed(), capped),
    ).run(spec);

    expect(ticketState()["byro-repo #1"]?.step).toBe("halted");
    const [halt] = haltComments();
    expect(halt).toContain("The checks are still red after 1 resume(s)");
  });
});
