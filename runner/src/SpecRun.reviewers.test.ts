import { describe, expect, it } from "vitest";

import type { StepResult } from "./AgentStep.ts";
import { FakeAgentStep } from "./FakeAgentStep.ts";
import { runKnobsOf } from "./runKnobs.ts";
import {
  addSpec,
  clonePaths,
  commitFile,
  findingOf,
  github,
  implemented,
  passes,
  progressLines,
  reviewed,
  reviewedInline,
  spec,
  specRun,
  type StepScript,
  useSpecRunHarness,
} from "./specRunHarness.ts";

useSpecRunHarness();

describe("a run's review that skips its reviewers", () => {
  const reviewerNote = "Reviewed without its reviewers";

  // Commits two.ts beside one.ts, a diff past the default inline size of one file.
  const implementedTwoFiles: StepScript = async (request) => {
    commitFile({
      cwd: request.cwd,
      file: "two.ts",
      content: "export {};\n",
      message: "Add two.ts",
    });
    return implemented("one.ts")(request);
  };

  function inReviewSession(result: StepResult): StepResult {
    return { ...result, sessionId: "review-session" };
  }

  function reviewListOf(ticket: number): string | undefined {
    return github.comments
      .map(({ body }) => body)
      .find((body) => body.includes(`<!-- review-list ticket=#${ticket} -->`));
  }

  it("resumes a review over the inline size that spawned no reviewers once, telling it to spawn both", async () => {
    addSpec([1]);
    const agentStep = FakeAgentStep.init(
      implementedTwoFiles,
      inReviewSession(reviewedInline()),
      reviewed(),
    );

    const result = await specRun(agentStep).run(spec);

    expect(result.kind).toBe("finished");
    expect(agentStep.requests).toHaveLength(3);
    const [, review, resumed] = agentStep.requests;
    expect(review?.prompt).not.toContain("may review it inline");
    expect(resumed?.resumeSessionId).toBe("review-session");
    expect(resumed?.prompt).toContain("Standards and Spec");
    expect(reviewListOf(1)).toBeUndefined();
  });

  it("keeps the resumed review's findings and sends them to resolve", async () => {
    addSpec([1]);
    const finding = findingOf({ line: 1, suggestedVerdict: "dismiss" });
    const agentStep = FakeAgentStep.init(
      implementedTwoFiles,
      inReviewSession(reviewedInline()),
      reviewed([finding]),
    );

    await specRun(agentStep).run(spec);

    expect(agentStep.requests[3]?.prompt).toContain(finding.claim);
  });

  it("records a second skip, logging it and showing on the review list that the review ran without its reviewers", async () => {
    addSpec([1]);
    const agentStep = FakeAgentStep.init(
      implementedTwoFiles,
      inReviewSession(reviewedInline()),
      { ...reviewedInline(), spawnedSubagents: 1 },
    );

    const result = await specRun(agentStep).run(spec);

    expect(result.kind).toBe("finished");
    expect(agentStep.requests).toHaveLength(3);
    expect(reviewListOf(1)).toContain(reviewerNote);
    expect(progressLines().join("\n")).toContain(
      "ran without its reviewer subagents",
    );
  });

  it("lets a one-file diff review inline, saying so in the prompt, and never sends it back", async () => {
    addSpec([1]);
    const agentStep = FakeAgentStep.init(
      implemented("one.ts"),
      reviewedInline(),
    );

    const result = await specRun(agentStep).run(spec);

    expect(result.kind).toBe("finished");
    expect(agentStep.requests).toHaveLength(2);
    expect(agentStep.requests[1]?.prompt).toContain("may review it inline");
    expect(reviewListOf(1)).toBeUndefined();
  });

  it("takes its inline size from the inlineReviewMaxFiles knob", async () => {
    addSpec([1]);
    const agentStep = FakeAgentStep.init(implementedTwoFiles, reviewedInline());
    const knobs = runKnobsOf({
      clonePaths,
      authChecks: [passes],
      inlineReviewMaxFiles: 2,
    });

    await specRun(agentStep, { knobs }).run(spec);

    expect(agentStep.requests).toHaveLength(2);
    expect(agentStep.requests[1]?.prompt).toContain("may review it inline");
  });
});
