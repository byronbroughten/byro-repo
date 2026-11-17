import { describe, expect, it } from "vitest";

import { schemaProblemsOf, sessionOutputOf } from "./recordSchema.ts";
import type { TrackedIssue } from "./SpecRun/runState.ts";
import { workflowsWith } from "./specRunHarness.ts";
import { trackedIssues } from "./specRunHarness/trackedIssues.ts";
import {
  agentStepOf,
  pickedWorkflowOf,
  sessionSchemaOf,
  ticketWorkflowNameOf,
  ticketWorkflowsOf,
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

function ticketLabelled(labels: string[]): TrackedIssue {
  return trackedIssues.issueOf(8, { labels, body: "" });
}

describe("ticketWorkflowNameOf", () => {
  it("picks piece for a `piece` ticket of a `code` spec", () => {
    expect(
      ticketWorkflowNameOf({
        ticket: ticketLabelled(["piece"]),
        spec: specLabelled(["code"]),
      }),
    ).toBe("piece");
  });

  it("picks code for a `code` ticket of a `piece` spec", () => {
    expect(
      ticketWorkflowNameOf({
        ticket: ticketLabelled(["code"]),
        spec: specLabelled(["piece"]),
      }),
    ).toBe("code");
  });

  it.each([
    { specLabels: ["piece"], name: "piece" },
    { specLabels: ["code"], name: "code" },
    { specLabels: [], name: "code" },
  ])(
    "follows a spec labelled $specLabels for a ticket with neither label",
    ({ specLabels, name }) => {
      expect(
        ticketWorkflowNameOf({
          ticket: ticketLabelled(["ready-for-agent"]),
          spec: specLabelled(specLabels),
        }),
      ).toBe(name);
    },
  );

  it("picks none for a ticket with neither label in a spec labelled both", () => {
    expect(
      ticketWorkflowNameOf({
        ticket: ticketLabelled(["ready-for-agent"]),
        spec: specLabelled(["code", "piece"]),
      }),
    ).toBeUndefined();
  });

  it("picks a Standalone ticket by its own label", () => {
    const standalone = specLabelled(["piece"]);

    expect(ticketWorkflowNameOf({ ticket: standalone, spec: standalone })).toBe(
      "piece",
    );
  });
});

describe("pickedWorkflowOf", () => {
  it("throws for a ticket with neither label in a spec labelled both, naming the ticket and the missing label", () => {
    expect(() =>
      pickedWorkflowOf(
        {
          ticket: ticketLabelled([]),
          spec: specLabelled(["code", "piece"]),
        },
        workflowsWith([]),
      ),
    ).toThrow(/byro-repo #8 .*`code` or `piece` label/);
  });
});

describe("ticketWorkflowsOf", () => {
  it("names each Workflow the spec's tickets pick once, leaving out a ticket that picks none", () => {
    const spec = specLabelled(["code", "piece"]);
    const tickets = [["piece"], ["code"], ["piece"], []].map(ticketLabelled);

    expect(
      ticketWorkflowsOf({ spec, tickets }, workflowsWith([])).map(
        ({ name }) => name,
      ),
    ).toEqual(["code", "piece"]);
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

  // #737's resolve record from #723's run, byro-repo-737-32-resolve.output.txt, trimmed to one record.
  const resolveWithSummary = {
    records: [
      {
        finding: 3,
        axis: "standards",
        where: "runner/src/specRunHarness/stepResults.ts:132-140",
        claim:
          "implemented() gains an inline `change` bag that recordOf also declares.",
        verdict: "dismiss",
        reason: "false-positive",
        evidence:
          "They share only the one field `change?: Partial<ImplementRecord>`, which is already a named type.",
      },
    ],
    summary:
      "I fixed findings 1 and 2 in commit 60fde8af and dismissed 3–9 with evidence.",
  };

  it("refuses a record holding a field of another session step's, as #737's resolver returned", () => {
    expect(
      schemaProblemsOf(sessionSchemaOf(code), { output: resolveWithSummary }),
    ).not.toEqual([]);
  });

  it.each([
    { workflow: code, step: "implement", record: blocked },
    { workflow: code, step: "review", record: { findings: [] } },
    { workflow: code, step: "resolve", record: { records: [] } },
    { workflow: code, step: "redChecks", record: { summary: "Fixed lint." } },
    {
      workflow: code,
      step: "mergeMaster",
      record: {
        summary: "Both sides renamed it.",
        files: ["byro-repo runner/src/Workflow.ts"],
      },
    },
    { workflow: piece, step: "implement", record: blocked },
    {
      workflow: piece,
      step: "review",
      record: { findings: [], dismissedOverlaps: [] },
    },
    { workflow: piece, step: "resolve", record: { records: [] } },
    { workflow: piece, step: "redChecks", record: { summary: "Cut a line." } },
  ] as const)(
    "passes the $workflow.name $step record under `output`, then unwrapped through the step's own schema",
    ({ workflow, step, record }) => {
      const sessionRecord = { output: record };

      expect(
        schemaProblemsOf(sessionSchemaOf(workflow), sessionRecord),
      ).toEqual([]);
      expect(
        schemaProblemsOf(
          agentStepOf(workflow, step).outputSchema,
          sessionOutputOf(sessionRecord),
        ),
      ).toEqual([]);
    },
  );

  it("refuses a record outside `output`, or a field no session step has", () => {
    const schema = sessionSchemaOf(code);

    expect(schemaProblemsOf(schema, { records: [] })).not.toEqual([]);
    expect(schemaProblemsOf(schema, { output: { verdicts: [] } })).not.toEqual(
      [],
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
