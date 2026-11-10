import { describe, expect, it } from "vitest";

import type { TrackedIssue } from "./SpecRun/runState.ts";
import { trackedIssues } from "./specRunHarness/trackedIssues.ts";
import { workflowNameOf, workflowOf } from "./Workflow.ts";

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
    expect(workflowOf(specLabelled([])).name).toBe("code");
  });

  it("picks code for a piece spec until the piece Workflow is registered", () => {
    expect(workflowOf(specLabelled(["piece"])).name).toBe("code");
  });
});
