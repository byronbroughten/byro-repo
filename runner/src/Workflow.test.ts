import { describe, expect, it } from "vitest";

import type { TrackedIssue } from "./SpecRun/runState.ts";
import { workflowsWith } from "./specRunHarness.ts";
import { trackedIssues } from "./specRunHarness/trackedIssues.ts";
import { agentStepOf, workflowNameOf, workflowOf } from "./Workflow.ts";

function specLabelled(labels: string[]): TrackedIssue {
  return trackedIssues.issueOf(7, { labels, body: "" });
}

describe("workflowNameOf", () => {
  it("reads a spec with no label as code", () => {
    expect(workflowNameOf(specLabelled([]))).toBe("code");
  });

  it("reads a spec with other labels as code", () => {
    expect(workflowNameOf(specLabelled(["ready-for-agent"]))).toBe("code");
  });

  it("reads a spec labelled `piece` as piece", () => {
    expect(workflowNameOf(specLabelled(["ready-for-agent", "piece"]))).toBe(
      "piece",
    );
  });
});

describe("workflowOf", () => {
  it("picks code for a spec with no label", () => {
    expect(workflowOf(specLabelled([]), workflowsWith([])).name).toBe("code");
  });

  it("picks piece for a piece spec", () => {
    expect(workflowOf(specLabelled(["piece"]), workflowsWith([])).name).toBe(
      "piece",
    );
  });
});

describe("agentStepOf", () => {
  it("throws for a step the Workflow leaves out", () => {
    const piece = workflowOf(specLabelled(["piece"]), workflowsWith([]));

    expect(() => agentStepOf(piece, "redChecks")).toThrow(
      "The piece Workflow has no redChecks step.",
    );
  });
});
