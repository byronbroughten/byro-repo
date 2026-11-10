import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { FakeAgentStep } from "./FakeAgentStep.ts";
import type { Halt } from "./halts.ts";
import { defaultRunKnobs } from "./runKnobs.ts";
import type { RunResult } from "./SpecRun.ts";
import {
  addSpec,
  commentsOn,
  github,
  haltComments,
  implemented,
  masterSubjects,
  refOf,
  resultOf,
  reviewed,
  runStatePath,
  spec,
  specRun,
  type StepScript,
  temp,
  ticketState,
  useSpecRunHarness,
} from "./specRunHarness.ts";
import type { ReadyResearchRecord, ResearchRecord } from "./stepRecords.ts";
import { toolsOf } from "./targetTools.ts";

useSpecRunHarness();

function addPieceSpec(tickets: number[]): void {
  addSpec(tickets);
  github.edit(spec.number, { labels: ["piece"] });
  tickets.forEach((ticket) => {
    github.edit(ticket, { labels: ["ready-for-agent", "research"] });
  });
}

describe("run on a piece spec", () => {
  it("refuses a ticket that isn't research at preflight, naming the drafting sequence", async () => {
    addPieceSpec([1, 2]);
    github.edit(2, { labels: ["ready-for-agent"] });
    const agentStep = FakeAgentStep.init();

    const result = await specRun(agentStep).run(spec);

    expect(result).toEqual<RunResult>({
      kind: "refused",
      landed: [],
      message:
        "A piece spec's drafting sequence isn't built yet, so the runner runs only its research tickets; not research: byro-repo #2.",
    });
    expect(agentStep.requests).toEqual([]);
  });

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
    expect(closing?.comment).toContain(newOutline);
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

describe("the Research Halt", () => {
  it("raises one Halt on a landed ticket's wanted facts and Outline edits, holding the drafting tickets", async () => {
    addDraftingSpec();
    const agentStep = FakeAgentStep.init(
      researched(readyRecordOf(scratchFolder())),
    );

    const result = await specRun(agentStep).run(spec);

    expect(result.message).toContain("byro-repo #2 waits on Halt H1");
    expect(haltComments()).toHaveLength(1);
    const [halt] = haltComments();
    expect(halt).toContain("Research Halt");
    expect(halt).toContain("**F1** The ferry carried forty people.");
    expect(halt).toContain(`**E1** The crossing: replace "${oldOutline}"`);
    expect(halt).toContain("Blocks: byro-repo#2 and their downstream.");
    expect(ticketState()["byro-repo #1"]?.step).toBe("landed");
    const saved = JSON.parse(readFileSync(runStatePath(), "utf8")) as {
      halts: Halt[];
    };
    expect(saved.halts.map(({ outlineEdits }) => outlineEdits)).toEqual([
      [
        {
          section: "The crossing",
          oldText: oldOutline,
          newText: newOutline,
          reason: "The logbook dates the ferry first.",
        },
      ],
    ]);
  });

  it("clears a dropped fact and leaves an unapproved edit out of the spec", async () => {
    addDraftingSpec();
    await specRun(
      FakeAgentStep.init(researched(readyRecordOf(scratchFolder()))),
    ).run(spec);
    github.reply(spec.number, "H1: drop F1");

    const result = await specRun(FakeAgentStep.init()).run(spec);

    expect(github.issues.get(spec.number)?.body).toBe(outlinedSpecBody);
    expect(result.message).toContain(draftingGoesOn);
  });

  it("raises no Halt on a record with only unwanted facts and no edits", async () => {
    addDraftingSpec();
    const record: ResearchRecord = {
      ...readyRecordOf(scratchFolder()),
      outlineEdits: [],
      unverified: [
        {
          fact: "The ferry was painted blue.",
          reason: "No source names its colour.",
          isWanted: false,
        },
      ],
    };

    const result = await specRun(FakeAgentStep.init(researched(record))).run(
      spec,
    );

    expect(haltComments()).toEqual([]);
    expect(result.message).toContain(draftingGoesOn);
  });

  it("doesn't call a landed ticket unlanded on a `stop spec` answer", async () => {
    addDraftingSpec();
    await specRun(
      FakeAgentStep.init(researched(readyRecordOf(scratchFolder()))),
    ).run(spec);
    github.reply(spec.number, "H1: stop spec");

    const result = await specRun(FakeAgentStep.init()).run(spec);

    expect(result.kind).toBe("stopped");
    expect(result.message).not.toContain("stays unlanded");
  });
});

const oldOutline = "the storm came, then the ferry ran.";
const newOutline = "the ferry ran before the storm came.";
const outlinedSpecBody = `## Deliverable\n\nThe crossing.\n\n## Outline\n\n- **The crossing**: ${oldOutline}\n\n## Facts\n\n- The ferry carried forty people.\n`;

// The drafting sequence (#639) isn't built, so the drafting ticket waits on the developer once no Halt holds it.
const draftingGoesOn = "byro-repo #2 waits on you";

// Research ticket #1 blocks drafting ticket #2, which isn't ready-for-agent, so the preflight refuses nothing.
function addDraftingSpec(): void {
  addPieceSpec([1, 2]);
  github.edit(2, { labels: [] });
  github.blockers.set(2, [1]);
  github.edit(spec.number, { body: outlinedSpecBody });
}

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

function readyRecordOf(folder: string): ReadyResearchRecord {
  return {
    status: "ready",
    commentPath: join(folder, "comment.md"),
    textsFolder: join(folder, "texts"),
    counts: { supported: 3, rewritten: 1, unverified: 1 },
    outlineEdits: [
      {
        section: "The crossing",
        oldText: oldOutline,
        newText: newOutline,
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
