import { describe, expect, it } from "vitest";

import type { StepResult } from "./AgentStep.ts";
import { FakeAgentStep } from "./FakeAgentStep.ts";
import { skippedReviewersNote } from "./reviewList.ts";
import { runKnobsOf } from "./runKnobs.ts";
import {
  addSpec,
  clonePaths,
  commitFile,
  crashed,
  findingOf,
  heldTicketLine,
  implemented,
  noConversation,
  passes,
  progressLines,
  reviewed,
  reviewedInline,
  reviewListOf,
  schemaFailedOf,
  spec,
  specRun,
  type StepScript,
  useSpecRunHarness,
  withoutHeldTicket,
} from "./specRunHarness.ts";

useSpecRunHarness();

describe("a run's review that skips its reviewers", () => {
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

  it("resumes a review over the inline size that spawned no reviewers once, in the implementer's session, telling it to spawn both", async () => {
    addSpec([1]);
    const agentStep = FakeAgentStep.init(
      implementedTwoFiles,
      inReviewSession(reviewedInline()),
      reviewed(),
    );

    const result = await specRun(agentStep).run(spec);

    expect(result.kind).toBe("finished");
    expect(agentStep.requests).toHaveLength(3);
    const [implementer, review, resumed] = agentStep.requests;
    expect(review?.prompt).not.toContain("may review it inline");
    expect(review?.resumeSessionId).toBe("session");
    expect(resumed?.resumeSessionId).toBe("review-session");
    expect(resumed?.sessionSchema).toEqual(implementer?.sessionSchema);
    expect(resumed?.logPath).toMatch(/-review\.jsonl$/);
    expect(resumed?.prompt).toContain("Standards and Spec");
    expect(reviewListOf(1)).toBeUndefined();
  });

  it("reruns the review fresh, by its own prompt, when the resume sending it back finds no conversation", async () => {
    addSpec([1]);
    const agentStep = FakeAgentStep.init(
      implementedTwoFiles,
      inReviewSession(reviewedInline()),
      noConversation,
      reviewed(),
    );

    const result = await specRun(agentStep).run(spec);

    expect(result.kind).toBe("finished");
    const [, review, lost, fresh] = agentStep.requests;
    expect(lost?.resumeSessionId).toBe("review-session");
    expect(fresh?.resumeSessionId).toBeUndefined();
    expect(review?.prompt).toContain(heldTicketLine);
    expect(fresh?.prompt).toBe(withoutHeldTicket(review?.prompt));
    expect(fresh?.prompt).not.toContain(heldTicketLine);
    expect(reviewListOf(1)).toBeUndefined();
  });

  it("runs the review fresh, never saying it holds the ticket, when its resume of the implementer finds no conversation", async () => {
    addSpec([1]);
    const agentStep = FakeAgentStep.init(
      implemented("one.ts"),
      noConversation,
      reviewed(),
    );

    const result = await specRun(agentStep).run(spec);

    expect(result.kind).toBe("finished");
    const [, lost, fresh] = agentStep.requests;
    expect(lost?.resumeSessionId).toBe("session");
    expect(lost?.prompt).toContain(heldTicketLine);
    expect(fresh?.resumeSessionId).toBeUndefined();
    expect(fresh?.prompt).toBe(withoutHeldTicket(lost?.prompt));
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
      { ...reviewedInline(), spawnedSubagentCount: 1 },
    );

    const result = await specRun(agentStep).run(spec);

    expect(result.kind).toBe("finished");
    expect(agentStep.requests).toHaveLength(3);
    expect(reviewListOf(1)).toContain(skippedReviewersNote);
    expect(progressLines().join("\n")).toContain(
      "once resumed, spawned 1 of its 2 reviewer subagents",
    );
  });

  it("counts the reviewers a crash-resumed review spawned before its crash, never sending it back", async () => {
    addSpec([1]);
    const agentStep = FakeAgentStep.init(
      implementedTwoFiles,
      { ...crashed, spawnedSubagentCount: 2 },
      reviewedInline(),
    );

    const result = await specRun(agentStep).run(spec);

    expect(result.kind).toBe("finished");
    expect(agentStep.requests).toHaveLength(3);
    expect(agentStep.requests[2]?.resumeSessionId).toBe("crashed-session");
    expect(reviewListOf(1)).toBeUndefined();
  });

  it("counts the reviewers a schema-resumed review spawned before its failed record, never sending it back", async () => {
    addSpec([1]);
    const agentStep = FakeAgentStep.init(
      implementedTwoFiles,
      inReviewSession({
        ...schemaFailedOf(["findings is required"]),
        spawnedSubagentCount: 2,
      }),
      reviewedInline(),
    );

    const result = await specRun(agentStep).run(spec);

    expect(result.kind).toBe("finished");
    expect(agentStep.requests).toHaveLength(3);
    expect(agentStep.requests[2]?.prompt).not.toContain("Standards and Spec");
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
