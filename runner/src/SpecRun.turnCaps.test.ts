import { describe, expect, it } from "vitest";

import type { StepResult } from "./AgentStep.ts";
import { FakeAgentStep } from "./FakeAgentStep.ts";
import {
  addSpec,
  eventOf,
  haltComments,
  implemented,
  progressLines,
  refOf,
  resultOf,
  reviewed,
  spec,
  specRun,
  ticketState,
  useSpecRunHarness,
} from "./specRunHarness.ts";

useSpecRunHarness();

const capped: StepResult = {
  ...resultOf(undefined),
  output: { status: "none" },
  sessionId: "capped-session",
  exitSubtype: "error_max_turns",
};

// #302 handles turn caps and unskips these.
describe.skip("run's review and triage turn caps", () => {
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
