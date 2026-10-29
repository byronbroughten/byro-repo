import { describe, expect, it } from "vitest";

import type { AgentStep, StepRequest, StepResult } from "./AgentStep.ts";
import { FakeAgentStep } from "./FakeAgentStep.ts";

const request: StepRequest = {
  prompt: "/implement byro-repo #216",
  pair: { model: "sonnet", effort: "high" },
  account: 1,
  cwd: "/Users/dev/byro-repo",
  gateRoot: "/Users/dev/byro-repo",
  maxTurns: 40,
  targets: [],
  jsonSchema: {},
};

function result(sessionId: string): StepResult {
  return {
    output: { status: "valid", record: { sessionId } },
    sessionId,
    account: 1,
    configFolder: undefined,
    transcriptPath: undefined,
    peakContext: 90_000,
    hasCrossedCeiling: false,
    hang: undefined,
    exitSubtype: "success",
    errorText: undefined,
    usage: undefined,
    limitHit: undefined,
    deniedTools: [],
  };
}

describe("FakeAgentStep", () => {
  it("returns its scripted results in order and keeps the requests", async () => {
    const fake = FakeAgentStep.init(result("first"), result("second"));
    const step: AgentStep = fake;
    expect((await step.run(request)).sessionId).toBe("first");
    expect((await step.run(request)).sessionId).toBe("second");
    expect(fake.requests).toEqual([request, request]);
  });

  it("throws once its script runs out", async () => {
    await expect(FakeAgentStep.init().run(request)).rejects.toThrow(
      "FakeAgentStep has no scripted result for step 1",
    );
  });
});
