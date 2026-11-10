import {
  existsSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import type {
  GoogleDocument,
  NamedStyleType,
  StructuralElement,
} from "./Docs/googleDocs.ts";
import { FakeAgentStep } from "./FakeAgentStep.ts";
import { git } from "./GitFixture.ts";
import { defaultRunKnobs } from "./runKnobs.ts";
import {
  addSpec,
  commentsOn,
  github,
  haltComments,
  holdDocs,
  implemented,
  masterSubjects,
  primaryOf,
  refOf,
  resultOf,
  reviewed,
  spec,
  specRun,
  type StepScript,
  temp,
  ticketState,
  useSpecRunHarness,
} from "./specRunHarness.ts";
import { stepResults } from "./specRunHarness/stepResults.ts";
import type { ResearchRecord } from "./stepRecords.ts";
import { toolsOf } from "./targetTools.ts";

useSpecRunHarness();

function addPieceSpec(tickets: number[]): void {
  addSpec(tickets);
  github.edit(spec.number, { labels: ["piece"] });
  tickets.forEach((ticket) => {
    github.edit(ticket, { labels: ["ready-for-agent", "research"] });
  });
}

describe("pull on a piece spec's drafting ticket", () => {
  function addDraftingSpec(): void {
    addSpec([1]);
    github.edit(spec.number, {
      labels: ["piece"],
      body: `## Deliverable\n\nThe crossing, doc ${deliverableId}.\n`,
    });
    holdDocs(
      docOf({
        "The harbour": "Gulls circled the quay at dawn.",
        "The crossing": "The ferry left late.",
      }),
    );
  }

  it("pulls every Section of a first ticket's Doc into the Agent draft, marked as the developer's, and commits it", async () => {
    addDraftingSpec();
    const agentStep = FakeAgentStep.init();

    const result = await specRun(agentStep).run(spec);

    expect(agentStep.requests).toEqual([]);
    expect(readFileSync(join(workspacePath(), draftPath), "utf8")).toBe(
      "## The harbour\n<!-- developer -->\n\nGulls circled the quay at dawn.\n\n## The crossing\n<!-- developer -->\n\nThe ferry left late.\n",
    );
    expect(git(workspacePath(), "log", "-1", "--format=%s")).toBe(
      "Pull the Deliverable into the Agent draft of byro-repo #213, for #1",
    );
    expect(git(workspacePath(), "status", "--porcelain")).toBe("");
    expect(result.landed).toEqual([]);
    expect(ticketState()["byro-repo #1"]?.step).toBe("stopped");
  });

  it("leaves a later ticket's earlier agent Sections as the file has them", async () => {
    addDraftingSpec();
    stepResults.commitFile({
      cwd: primaryOf("byro-repo"),
      file: draftPath,
      content:
        "## The harbour\n<!-- developer -->\n\nAn older dawn.\n\n## The crossing\n<!-- agent -->\n\nThe ferry slipped its moorings at noon.\n",
      message: "Land an earlier ticket's Agent draft",
    });

    await specRun(FakeAgentStep.init()).run(spec);

    expect(readFileSync(join(workspacePath(), draftPath), "utf8")).toBe(
      "## The harbour\n<!-- developer -->\n\nGulls circled the quay at dawn.\n\n## The crossing\n<!-- agent -->\n\nThe ferry slipped its moorings at noon.\n",
    );
  });

  it("records each Section's Doc text as the push baseline", async () => {
    addDraftingSpec();

    await specRun(FakeAgentStep.init()).run(spec);

    expect(ticketState()["byro-repo #1"]?.pullBaseline).toEqual({
      documentId: deliverableId,
      revisionId: "crossing-1",
      sections: {
        "The harbour": "Gulls circled the quay at dawn.\n",
        "The crossing": "The ferry left late.\n",
      },
    });
  });

  it("stops a ticket whose spec names no Deliverable Doc, pulling nothing", async () => {
    addDraftingSpec();
    github.edit(spec.number, { body: "## Deliverable\n\nThe crossing.\n" });

    await specRun(FakeAgentStep.init()).run(spec);

    expect(ticketState()["byro-repo #1"]?.step).toBe("stopped");
    expect(commentsOn(spec.number, "names no Doc ID")).toHaveLength(1);
    expect(existsSync(join(workspacePath(), draftPath))).toBe(false);
  });
});

const draftPath = "writing/agent-drafts/213.md";

function workspacePath(): string {
  return join(temp, "workspaces", "byro-repo-issue-1-ticket-1");
}

// A Doc of one level-2 heading and one paragraph per Section.
function docOf(sections: Record<string, string>): GoogleDocument {
  const content = Object.entries(sections).flatMap(([heading, text]) => [
    paragraphOf(heading, "HEADING_2"),
    paragraphOf(text, "NORMAL_TEXT"),
  ]);
  return {
    documentId: deliverableId,
    revisionId: "crossing-1",
    body: { content },
  };
}

function paragraphOf(
  text: string,
  namedStyleType: NamedStyleType,
): StructuralElement {
  return {
    paragraph: {
      elements: [{ textRun: { content: `${text}\n` } }],
      paragraphStyle: { namedStyleType },
    },
  };
}

describe("run on a piece spec", () => {
  it("runs a research ticket's research step under its own knobs and keeps its record", async () => {
    addPieceSpec([1]);
    const record = readyRecordOf(scratchFolder());
    const agentStep = FakeAgentStep.init(researched(record));

    await specRun(agentStep).run(spec);

    const [request] = agentStep.requests;
    expect(agentStep.requests).toHaveLength(1);
    expect(request?.maxTurns).toBe(defaultRunKnobs.maxTurns.research);
    expect(request?.wallClockMs).toBe(defaultRunKnobs.wallClockMs.research);
    expect(request?.logPath).toMatch(/byro-repo-1-1-research\.jsonl$/);
    expect(request?.prompt).toContain(".claude/skills/research-piece/SKILL.md");
    expect(ticketState()["byro-repo #1"]?.researchRecord).toEqual(record);
  });

  it("checks the quotes, posts the comment, writes the outcome row and closes the ticket", async () => {
    addPieceSpec([1]);
    const record = readyRecordOf(scratchFolder());

    const result = await specRun(FakeAgentStep.init(researched(record))).run(
      spec,
    );

    expect(result.landed).toEqual([refOf(1)]);
    expect(commentsOn(1, "The ferry ran.")).toHaveLength(1);
    expect(masterSubjects()).toContainEqual(
      expect.stringMatching(/^Record the #1 outcome/),
    );
    const closing = github.closed.find(({ issue }) => issue.number === 1);
    expect(closing?.comment).toContain("Move the ferry before the storm.");
    expect(ticketState()["byro-repo #1"]?.step).toBe("landed");
  });

  it("sends red quotes back to the research step once, with the failure", async () => {
    addPieceSpec([1]);
    const folder = scratchFolder("The ferry ran. MISQUOTE");
    const agentStep = FakeAgentStep.init(
      researched(readyRecordOf(folder)),
      async () => {
        writeFileSync(join(folder, "comment.md"), "The ferry ran.\n");
        return resultOf({ record: readyRecordOf(folder) });
      },
    );

    const result = await specRun(agentStep).run(spec);

    expect(agentStep.requests).toHaveLength(2);
    expect(agentStep.requests[1]?.prompt).toContain("NOT FOUND: MISQUOTE");
    expect(agentStep.requests[1]?.prompt).toContain(join(folder, "comment.md"));
    expect(result.landed).toEqual([refOf(1)]);
  });

  it("raises a Failure Halt on quotes still red after one send-back", async () => {
    addPieceSpec([1]);
    const record = readyRecordOf(scratchFolder("The ferry ran. MISQUOTE"));
    const agentStep = FakeAgentStep.init(
      researched(record),
      researched(record),
    );

    const result = await specRun(agentStep).run(spec);

    expect(agentStep.requests).toHaveLength(2);
    expect(result.landed).toEqual([]);
    expect(ticketState()["byro-repo #1"]?.step).toBe("halted");
    expect(haltComments()[0]).toContain("Failure Halt");
    expect(haltComments()[0]).toContain("NOT FOUND: MISQUOTE");
    expect(commentsOn(1, "The ferry ran.")).toEqual([]);
  });

  it("launches the research step with Drive reads of the spec's sources only", async () => {
    addPieceSpec([1]);
    github.edit(spec.number, {
      body: `## Deliverable\n\nThe crossing, doc ${deliverableId}.\n\n## Supporting Material\n\n- The lighthouse logbook, ${logbookId}: the storm.\n- The ferry timetable, https://drive.google.com/file/d/${timetableId}/view: the crossings.\n\n## Reader\n\nA ferry clerk.\n`,
    });
    const agentStep = FakeAgentStep.init(
      researched(readyRecordOf(scratchFolder())),
    );

    await specRun(agentStep).run(spec);

    expect(agentStep.requests[0]?.targets).toEqual([
      { kind: "source", id: logbookId },
      { kind: "source", id: timetableId },
    ]);
    expect(toolsOf(agentStep.requests[0]?.targets ?? [])).toEqual([
      "mcp__gworkspace__get_drive_file_content",
      "mcp__gworkspace__get_drive_file_download_url",
    ]);
  });

  it("halts on a research record that breaks its schema", async () => {
    addPieceSpec([1]);
    const broken = { ...readyRecordOf(scratchFolder()), counts: undefined };

    const result = await specRun(FakeAgentStep.init(researched(broken))).run(
      spec,
    );

    expect(result.kind).toBe("stopped");
    expect(ticketState()["byro-repo #1"]?.step).toBe("halted");
    expect(haltComments()[0]).toContain("Failure Halt");
    expect(haltComments()[0]).toContain("counts");
  });

  it("halts on a ready record whose comment isn't there", async () => {
    addPieceSpec([1]);
    const folder = scratchFolder();
    const record = readyRecordOf(folder);
    rmSync(join(folder, "comment.md"));

    await specRun(FakeAgentStep.init(researched(record))).run(spec);

    expect(ticketState()["byro-repo #1"]?.step).toBe("halted");
    expect(haltComments()[0]).toContain("Failure Halt");
    expect(haltComments()[0]).toContain(
      `the comment at ${join(folder, "comment.md")} isn't there`,
    );
  });

  it("raises a blocked record's blockers as Halts", async () => {
    addPieceSpec([1]);
    const record: ResearchRecord = {
      status: "blocked",
      blockers: [
        {
          kind: "spec-ambiguity",
          detail: "The Facts field names two tellings of the walk.",
          recommendation: "Keep the earlier telling.",
        },
      ],
    };

    await specRun(FakeAgentStep.init(researched(record))).run(spec);

    expect(ticketState()["byro-repo #1"]?.step).toBe("halted");
    expect(haltComments()[0]).toContain(
      "The Facts field names two tellings of the walk.",
    );
  });

  it("posts a handoff record's handoff and starts a fresh research step from it", async () => {
    addPieceSpec([1]);
    const record = readyRecordOf(scratchFolder());
    const agentStep = FakeAgentStep.init(
      researched({
        status: "handoff",
        blockers: [],
        handoff: {
          conclusion:
            "Read the lighthouse logbook; the ferry timetable is left.",
          sourcesDone: ["lighthouse logbook"],
          sourcesLeft: ["ferry timetable"],
        },
      }),
      researched(record),
    );

    await specRun(agentStep).run(spec);

    expect(agentStep.requests).toHaveLength(2);
    expect(agentStep.requests[1]?.prompt).toContain("ferry timetable");
    expect(commentsOn(1, "## Handoff")[0]).toContain(
      "Read the lighthouse logbook; the ferry timetable is left.",
    );
    expect(ticketState()["byro-repo #1"]?.researchRecord).toEqual(record);
  });
});

const deliverableId = "1DeliverableCrossingDoc0000000000";
const logbookId = "1LighthouseLogbook000000000000000";
const timetableId = "1FerryTimetable_2-0000000000000000";

// The harness's quote check is red on a comment holding MISQUOTE.
function scratchFolder(fact = "The ferry ran."): string {
  const folder = join(temp, "research-scratch");
  mkdirSync(join(folder, "texts"), { recursive: true });
  writeFileSync(join(folder, "comment.md"), `## Research\n\n${fact}\n`);
  return folder;
}

function readyRecordOf(folder: string): ResearchRecord {
  return {
    status: "ready",
    commentPath: join(folder, "comment.md"),
    textsFolder: join(folder, "texts"),
    counts: { supported: 3, rewritten: 1, unverified: 1 },
    outlineEdits: [
      {
        section: "The crossing",
        edit: "Move the ferry before the storm.",
        reason: "The logbook dates the ferry first.",
      },
    ],
    unverified: [
      {
        fact: "The ferry carried forty people.",
        reason: "No source counts them.",
        isWanted: true,
      },
    ],
    blockers: [],
  };
}

function researched(record: unknown): StepScript {
  return async () => resultOf({ record });
}

describe("run on a spec with no label", () => {
  it("runs a research-labelled ticket as code", async () => {
    addSpec([1]);
    github.edit(1, { labels: ["ready-for-agent", "research"] });

    const result = await specRun(
      FakeAgentStep.init(implemented("one.ts"), reviewed()),
    ).run(spec);

    expect(result.landed).toEqual([refOf(1)]);
  });
});
