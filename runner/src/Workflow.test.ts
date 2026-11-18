import { describe, expect, it } from "vitest";

import { GapCheckPrompt } from "./promptText/GapCheckPrompt.ts";
import { schemaProblemsOf, sessionOutputOf } from "./recordSchema.ts";
import type { TrackedIssue, Wait } from "./SpecRun/runState.ts";
import { workflowsWith } from "./specRunHarness.ts";
import { trackedIssues } from "./specRunHarness/trackedIssues.ts";
import {
  agentStepOf,
  gapCheckInputOf,
  pickedWorkflowOf,
  pushWorkflowOf,
  rowWorkflowNameOf,
  sessionSchemaOf,
  specEndOf,
  ticketWorkflowNameOf,
  ticketWorkflowsOf,
} from "./Workflow.ts";

function specLabelled(labels: string[]): TrackedIssue {
  return trackedIssues.issueOf(7, { labels, body: "" });
}

const { code, piece } = workflowsWith([]);

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

  it.each([[["code"]], [["piece"]], [["code", "piece"]], [[]]])(
    "picks none for a ticket labelled both in a spec labelled %j",
    (specLabels) => {
      expect(
        ticketWorkflowNameOf({
          ticket: ticketLabelled(["code", "piece"]),
          spec: specLabelled(specLabels),
        }),
      ).toBeUndefined();
    },
  );

  it("picks a Standalone ticket by its own label", () => {
    const standalone = specLabelled(["piece"]);

    expect(ticketWorkflowNameOf({ ticket: standalone, spec: standalone })).toBe(
      "piece",
    );
  });

  it("picks none for a Standalone ticket labelled both", () => {
    const standalone = specLabelled(["code", "piece"]);

    expect(
      ticketWorkflowNameOf({ ticket: standalone, spec: standalone }),
    ).toBeUndefined();
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

  it("throws for a ticket labelled both, naming the ticket and saying it must keep only one", () => {
    expect(() =>
      pickedWorkflowOf(
        {
          ticket: ticketLabelled(["code", "piece"]),
          spec: specLabelled(["code"]),
        },
        workflowsWith([]),
      ),
    ).toThrow(/byro-repo #8 has both .*keep only one/);
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

describe("rowWorkflowNameOf", () => {
  it("names piece for a ticket that picks none in a spec labelled both", () => {
    expect(
      rowWorkflowNameOf({
        ticket: ticketLabelled([]),
        spec: specLabelled(["code", "piece"]),
      }),
    ).toBe("piece");
  });

  it("names the ticket's own Workflow otherwise", () => {
    expect(
      rowWorkflowNameOf({
        ticket: ticketLabelled(["code"]),
        spec: specLabelled(["code", "piece"]),
      }),
    ).toBe("code");
  });
});

describe("specEndOf", () => {
  const editGate: Wait = {
    ticket: { repo: "byro-repo", number: 3 },
    reason: "developer",
    text: "",
    labels: ["ready-for-human", "piece"],
  };
  const haltedTicket: Wait = {
    ticket: { repo: "byro-repo", number: 2 },
    reason: "halted",
    text: "",
  };

  it("runs the union of the Workflows' spec-end Steps in one order, each once", () => {
    expect(specEndOf([code, piece]).steps).toEqual([
      "gap-check",
      "judge",
      "push",
    ]);
    expect(specEndOf([piece, code]).steps).toEqual([
      "gap-check",
      "judge",
      "push",
    ]);
  });

  it("is due when any Workflow's trigger is, so a piece ticket's Edit gate holds back no Step", () => {
    expect(specEndOf([code, piece]).isDue([editGate])).toBe(true);
    expect(specEndOf([code]).isDue([editGate])).toBe(false);
  });

  it("is not due while a ticket no Workflow lets stay open waits", () => {
    expect(specEndOf([code, piece]).isDue([haltedTicket])).toBe(false);
  });

  it("has no Steps and is never due for an empty set", () => {
    const specEnd = specEndOf([]);

    expect(specEnd.steps).toEqual([]);
    expect(specEnd.isDue([])).toBe(false);
  });

  it("adds the line of the first Workflow that has one", () => {
    const spec = trackedIssues.issueOf(7, {
      labels: ["code"],
      body: "## Deliverable\n\nThe crossing, doc 1DeliverableCrossingDoc0000000000.\n",
    });

    expect(specEndOf([code, piece]).nextLineOf(spec, [editGate])).toContain(
      "`/close-project byro-repo 7`",
    );
  });
});

describe("a mixed spec's gap-check prompt", () => {
  const spec = trackedIssues.issueOf(7, { labels: ["code"], body: "" });
  const tickets = [
    {
      ...trackedIssues.issueOf(1, { labels: ["piece"], body: "" }),
      isOpen: false,
    },
    {
      ...trackedIssues.issueOf(2, { labels: ["code"], body: "" }),
      isOpen: false,
    },
    trackedIssues.issueOf(3, {
      labels: ["ready-for-human", "piece"],
      body: "",
    }),
  ];
  const prompt = GapCheckPrompt.init(
    gapCheckInputOf({ spec, tickets, workflows: [code, piece] }),
  ).text;

  it("holds both Workflows' sections", () => {
    expect(prompt).toContain("## The code tickets' work: master");
    expect(prompt).toContain("## The piece tickets' work: the Agent draft");
    expect(prompt).toContain("`writing/agent-drafts/7.md`");
    expect(prompt).toContain("Check only what no review checks");
  });

  it("marks each ticket's Workflow, the Edit gate as open", () => {
    expect(prompt).toContain('- byro-repo #1, "Ticket 1" (piece)');
    expect(prompt).toContain('- byro-repo #2, "Ticket 2" (code)');
    expect(prompt).toContain(
      '- byro-repo #3, "Ticket 3" (piece; open: the Edit gate)',
    );
  });

  it("checks a ticket's stories where its work is, and a story no ticket took against both", () => {
    expect(prompt).toContain(
      "Check a story a ticket took where that ticket's work is, by its Workflow below.",
    );
    expect(prompt).toContain(
      "whether no ticket names it or the ticket that did was closed as not planned, against each of master and the Agent draft.",
    );
  });

  it("drafts each follow-up by the kind its place takes", () => {
    expect(prompt).toContain("A gap there drafts a follow-up issue.");
    expect(prompt).toContain("A gap there drafts a drafting ticket.");
    expect(prompt).toContain(
      "a follow-up issue for a gap in master, or a drafting ticket for a gap in the Agent draft",
    );
  });
});

describe("pushWorkflowOf", () => {
  it("takes the Workflow with push rules", () => {
    expect(pushWorkflowOf([code, piece]).name).toBe("piece");
  });

  it("throws for a set with no push rules", () => {
    expect(() => pushWorkflowOf([code])).toThrow(/push step/);
  });
});

describe("agentStepOf", () => {
  it("throws for a step the Workflow leaves out", () => {
    expect(() => agentStepOf(piece, "mergeMaster")).toThrow(
      "The piece Workflow has no mergeMaster step.",
    );
  });
});

describe("sessionSchemaOf", () => {
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

  it("keeps a piece Fix's claim and where as recorded", () => {
    expect(piece.whatReviewCaughtOf([fix])).toBe(
      "Fixed: A private claim. (## A private heading).",
    );
  });

  it("names a code Fix by its claim and where", () => {
    expect(code.whatReviewCaughtOf([fix])).toBe(
      "Fixed: A private claim. (## A private heading).",
    );
  });
});
