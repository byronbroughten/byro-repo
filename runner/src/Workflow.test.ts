import { describe, expect, it } from "vitest";

import { schemaProblemsOf } from "./recordSchema.ts";
import type { TrackedIssue } from "./SpecRun/runState.ts";
import { workflowsWith } from "./specRunHarness.ts";
import { trackedIssues } from "./specRunHarness/trackedIssues.ts";
import {
  agentStepOf,
  sessionSchemaOf,
  workflowNameOf,
  workflowOf,
} from "./Workflow.ts";

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

    expect(() => agentStepOf(piece, "mergeMaster")).toThrow(
      "The piece Workflow has no mergeMaster step.",
    );
  });
});

describe("sessionSchemaOf", () => {
  const code = workflowOf(specLabelled([]), workflowsWith([]));
  const piece = workflowOf(specLabelled(["piece"]), workflowsWith([]));
  const blocked = {
    record: {
      status: "blocked",
      branches: [],
      closingComment: "",
      boxesUndone: [],
      blockers: [
        {
          kind: "spec-ambiguity",
          detail: "The ticket names no package.",
          recommendation: "Name one.",
        },
      ],
    },
  };

  it("names the fields of every step that shares the implementer's session, and no other's", () => {
    expect(
      Object.keys(
        (sessionSchemaOf(code) as { properties: object }).properties,
      ).sort(),
    ).toEqual(["files", "record", "records", "summary", "unsure"]);
    expect(
      Object.keys(
        (sessionSchemaOf(piece) as { properties: object }).properties,
      ).sort(),
    ).toEqual(["record", "records", "summary"]);
  });

  it("passes each session step's record, and refuses a field none of them has", () => {
    const schema = sessionSchemaOf(code);

    expect(schemaProblemsOf(schema, blocked)).toEqual([]);
    expect(schemaProblemsOf(schema, { records: [] })).toEqual([]);
    expect(schemaProblemsOf(schema, { summary: "Fixed the lint." })).toEqual(
      [],
    );
    expect(
      schemaProblemsOf(schema, {
        summary: "Both sides renamed it.",
        files: ["byro-repo runner/src/Workflow.ts"],
      }),
    ).toEqual([]);
    expect(schemaProblemsOf(schema, { findings: [] })).toEqual([
      "/ must NOT have additional properties",
    ]);
  });

  it("throws when two session steps define one field differently", () => {
    const clashing = {
      ...code,
      agentSteps: {
        ...code.agentSteps,
        mergeMaster: {
          promptOf: () => "",
          outputSchema: {
            type: "object",
            properties: { summary: { type: "integer" } },
          },
        },
      },
    };

    expect(() => sessionSchemaOf(clashing)).toThrow(
      "The code Workflow's session steps define `summary` differently.",
    );
  });
});

describe("whatReviewCaughtOf", () => {
  const fix = {
    finding: 1,
    axis: "standards",
    where: "## A private heading",
    claim: "A private claim.",
    rule: "Craft sheet's Garden path",
    verdict: "fix",
    evidence: "Reworded it.",
  } as const;

  it("names a piece Fix by axis and the rule sheet's own rule name only", () => {
    const piece = workflowOf(specLabelled(["piece"]), workflowsWith([]));

    expect(piece.whatReviewCaughtOf([fix])).toBe(
      'Fixed: standards, Craft "Garden path" ×1',
    );
  });

  it("names a code Fix by its claim and where", () => {
    const code = workflowOf(specLabelled([]), workflowsWith([]));

    expect(code.whatReviewCaughtOf([fix])).toBe(
      "Fixed: A private claim. (## A private heading).",
    );
  });
});
