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
import type { Halt } from "./halts.ts";
import { defaultRunKnobs } from "./runKnobs.ts";
import {
  addSpec,
  commentsOn,
  github,
  haltComments,
  handoffResultOf,
  holdDocs,
  implemented,
  masterSubjects,
  primaryOf,
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
import { stepResults } from "./specRunHarness/stepResults.ts";
import type {
  PieceImplementRecord,
  ReadyResearchRecord,
  ResearchRecord,
  ResolveRecord,
  ReviewFinding,
} from "./stepRecords.ts";
import { toolsOf } from "./targetTools.ts";

useSpecRunHarness();

function addPieceSpec(tickets: number[]): void {
  addSpec(tickets);
  github.edit(spec.number, { labels: ["piece"] });
  tickets.forEach((ticket) => {
    github.edit(ticket, { labels: ["ready-for-agent", "research"] });
  });
}

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

describe("pull on a piece spec's drafting ticket", () => {
  it("pulls every Section of a first ticket's Doc into the Agent draft, marked as the developer's, and commits it", async () => {
    addDraftingSpec();
    const seen = { draft: "", subject: "", status: "" };
    const agentStep = FakeAgentStep.init(async (request) => {
      seen.draft = readFileSync(join(request.cwd, draftPath), "utf8");
      seen.subject = git(request.cwd, "log", "-1", "--format=%s");
      seen.status = git(request.cwd, "status", "--porcelain");
      return drafted()(request);
    });

    await specRun(agentStep).run(spec);

    expect(seen).toEqual({
      draft:
        "## The harbour\n<!-- developer -->\n\nGulls circled the quay at dawn.\n\n## The crossing\n<!-- developer -->\n\nThe ferry left late.\n",
      subject:
        "Pull the Deliverable into the Agent draft of byro-repo #213, for #1",
      status: "",
    });
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
    let pulled = "";

    await specRun(
      FakeAgentStep.init(async (request) => {
        pulled = readFileSync(join(request.cwd, draftPath), "utf8");
        return drafted()(request);
      }),
    ).run(spec);

    expect(pulled).toBe(
      "## The harbour\n<!-- developer -->\n\nGulls circled the quay at dawn.\n\n## The crossing\n<!-- agent -->\n\nThe ferry slipped its moorings at noon.\n",
    );
  });

  it("records each Section's Doc text as the push baseline", async () => {
    addDraftingSpec();

    await specRun(FakeAgentStep.init(drafted())).run(spec);

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

describe("implement on a piece spec's drafting ticket", () => {
  it("drafts the ticket's Sections after pull, keeps the record and stops after resolve, before the unbuilt checks", async () => {
    addDraftingSpec();
    const agentStep = FakeAgentStep.init(
      drafted(),
      pieceReviewed(),
      pieceResolved([readerFix]),
    );

    const result = await specRun(agentStep).run(spec);

    const [request] = agentStep.requests;
    expect(agentStep.requests).toHaveLength(3);
    expect(request?.prompt).toContain("docs/writing-voice.md");
    expect(request?.prompt).toContain("docs/writing-craft.md");
    expect(request?.prompt).toContain(draftPath);
    expect(git(workspacePath(), "log", "-1", "--format=%s", "HEAD~1")).toBe(
      "Draft The crossing in the Agent draft",
    );
    expect(ticketState()["byro-repo #1"]?.record).toMatchObject({
      status: "committed",
      sectionsDrafted: ["The crossing"],
    });
    expect(result.landed).toEqual([]);
    expect(ticketState()["byro-repo #1"]?.step).toBe("stopped");
    expect(commentsOn(spec.number, "no checks step")).toHaveLength(1);
  });

  it("names a passages folder in the workspace, outside the Agent draft and gitignored, and keeps it", async () => {
    addDraftingSpec();
    const agentStep = FakeAgentStep.init(async (request) => {
      writeFileSync(join(passagesPath(), "logbook.txt"), "The storm came.\n");
      return drafted()(request);
    });

    await specRun(agentStep).run(spec);

    expect(agentStep.requests[0]?.prompt).toContain(passagesPath());
    expect(readFileSync(join(passagesPath(), "logbook.txt"), "utf8")).toBe(
      "The storm came.\n",
    );
    expect(git(workspacePath(), "status", "--porcelain")).toBe("");
  });

  it("halts on a committed record with no sectionsDrafted", async () => {
    addDraftingSpec();

    await specRun(
      FakeAgentStep.init(drafted({ sectionsDrafted: undefined })),
    ).run(spec);

    expect(ticketState()["byro-repo #1"]?.step).toBe("halted");
    expect(haltComments()[0]).toContain("Failure Halt");
    expect(haltComments()[0]).toContain("sectionsDrafted");
  });

  it("posts a handoff and gives the fresh step the same passages folder", async () => {
    addDraftingSpec();
    const passage = join(passagesPath(), "logbook.txt");
    const agentStep = FakeAgentStep.init(
      async () => {
        writeFileSync(passage, "The storm came.\n");
        return handoffResultOf({
          conclusion: "Drafted half of The crossing.",
          filesToOpen: [
            { path: draftPath, lines: "5-9" },
            { path: passage, lines: "1" },
          ],
          ruledOut: [],
          filesChanged: [draftPath],
          stillFailing: [],
        });
      },
      drafted(),
      pieceReviewed(),
      pieceResolved([readerFix]),
    );

    await specRun(agentStep).run(spec);

    expect(agentStep.requests).toHaveLength(4);
    expect(agentStep.requests[1]?.prompt).toContain(
      "Handoff from the previous step",
    );
    expect(agentStep.requests[1]?.prompt).toContain(`${passage}:1`);
    expect(agentStep.requests[1]?.prompt).toContain(passagesPath());
    expect(commentsOn(1, "## Handoff")[0]).toContain(`${draftPath}:5-9`);
    expect(existsSync(passage)).toBe(true);
    expect(ticketState()["byro-repo #1"]?.record?.status).toBe("committed");
  });

  it("launches with Drive reads of the spec's sources", async () => {
    addDraftingSpec();
    github.edit(spec.number, {
      body: `## Deliverable\n\nThe crossing, doc ${deliverableId}.\n\n## Supporting Material\n\n- The lighthouse logbook, ${logbookId}: the storm.\n`,
    });
    const agentStep = FakeAgentStep.init(drafted());

    await specRun(agentStep).run(spec);

    expect(agentStep.requests[0]?.targets).toEqual([
      { kind: "source", id: logbookId },
    ]);
  });

  it("resumes a ticket halted in implement in its own session, without pulling again", async () => {
    addDraftingSpec();
    await specRun(FakeAgentStep.init(blockedDraft)).run(spec);
    github.reply(spec.number, "H1: keep the earlier telling.");
    holdDocs(
      docOf({
        "The harbour": "The Doc moved on.",
        "The crossing": "The ferry left late.",
      }),
    );
    const agentStep = FakeAgentStep.init(drafted());

    await specRun(agentStep).run(spec);

    expect(agentStep.requests[0]?.resumeSessionId).toBe("implement-session");
    expect(agentStep.requests[0]?.prompt).toContain(
      "H1: keep the earlier telling.",
    );
    expect(ticketState()["byro-repo #1"]?.pullBaseline?.sections).toMatchObject(
      { "The harbour": "Gulls circled the quay at dawn.\n" },
    );
    expect(ticketState()["byro-repo #1"]?.record?.status).toBe("committed");
  });
});

describe("review on a piece spec's drafting ticket", () => {
  it("reviews the drafted ticket in a fresh session that reads /review-piece by its path, over the Agent draft and passages folder", async () => {
    addDraftingSpec();
    const agentStep = FakeAgentStep.init(drafted(), pieceReviewed());

    await specRun(agentStep).run(spec);

    const review = agentStep.requests[1];
    expect(review?.resumeSessionId).toBeUndefined();
    expect(review?.logPath).toMatch(/byro-repo-1-\d+-review\.jsonl$/);
    expect(review?.prompt).toContain(".claude/skills/review-piece/SKILL.md");
    expect(review?.prompt).toContain(draftPath);
    expect(review?.prompt).toContain(passagesPath());
  });

  it("keeps a record's reader finding", async () => {
    addDraftingSpec();

    await specRun(FakeAgentStep.init(drafted(), pieceReviewed())).run(spec);

    expect(ticketState()["byro-repo #1"]?.findings).toEqual([readerFinding]);
  });

  it("halts on a review record with no dismissedOverlaps", async () => {
    addDraftingSpec();
    const noOverlaps = async () => resultOf({ findings: [readerFinding] });

    await specRun(FakeAgentStep.init(drafted(), noOverlaps)).run(spec);

    expect(ticketState()["byro-repo #1"]?.step).toBe("halted");
    expect(haltComments()[0]).toContain("Failure Halt");
    expect(haltComments()[0]).toContain("dismissedOverlaps");
  });
});

describe("resolve on a piece spec's drafting ticket", () => {
  it("resumes the implementer to settle the findings under the piece rules, landing its Fixes in one commit and keeping the records", async () => {
    addDraftingSpec();
    const agentStep = FakeAgentStep.init(
      async (request) => ({
        ...(await drafted()(request)),
        sessionId: "implement-session",
        peakContext: 90_000,
      }),
      pieceReviewed(),
      pieceResolved([readerFix]),
    );

    await specRun(agentStep).run(spec);

    const resolver = agentStep.requests[2];
    expect(resolver?.resumeSessionId).toBe("implement-session");
    expect(resolver?.prompt).toContain("`## Piece findings`");
    expect(resolver?.prompt).toContain(draftPath);
    expect(resolver?.prompt).toContain(passagesPath());
    expect(
      git(workspacePath(), "log", "-2", "--format=%s").split("\n"),
    ).toEqual([
      "Reword The crossing as the escape, review of #1",
      "Draft The crossing in the Agent draft",
    ]);
    expect(ticketState()["byro-repo #1"]?.resolveRecords).toEqual([
      { ...readerFix, suggestedVerdict: "fix" },
    ]);
  });

  it.each([
    ["a Propose `ticket`", { verdict: "propose", reason: "ticket" }],
    ["a Dismiss `kept`", { verdict: "dismiss", reason: "kept" }],
    [
      "a Dismiss `tooling-enforced`",
      { verdict: "dismiss", reason: "tooling-enforced" },
    ],
  ] as const)(
    "refuses %s on a piece finding, through a retry to a Failure Halt",
    async (named, change) => {
      addDraftingSpec();
      const unused: ResolveRecord = {
        ...readerFix,
        ...change,
        quote: `${draftPath}:7 "The ferry slipped out at noon."`,
        recommendation: "Leave it.",
        draftIssueTitle: "Reword the crossing",
      };

      await specRun(
        FakeAgentStep.init(
          drafted(),
          pieceReviewed(),
          pieceResolved([unused], { isFixed: false }),
          pieceResolved([unused], { isFixed: false }),
        ),
      ).run(spec);

      expect(ticketState()["byro-repo #1"]?.step).toBe("halted");
      expect(haltComments()[0]).toContain("Failure Halt");
      expect(haltComments()[0]).toContain(
        `finding 1: a piece finding never takes ${named}`,
      );
    },
  );
});

const draftPath = "writing/agent-drafts/213.md";

const readerFix: ResolveRecord = {
  finding: 1,
  axis: "reader",
  where: `${draftPath}:7`,
  claim: "The crossing reads as a delay, not the Outline's escape.",
  quote: `${draftPath}:7 "The ferry slipped out at noon."`,
  rule: "The spec's Outline: the crossing is the escape.",
  verdict: "fix",
  evidence: "Rewording the line answers it with no new fact.",
};

// Rewords The crossing and commits it, as a resolver landing its Fix verdicts would, unless told the records hold none.
function pieceResolved(
  records: ResolveRecord[],
  { isFixed = true }: { isFixed?: boolean } = {},
): StepScript {
  return async (request) => {
    if (isFixed) {
      stepResults.commitFile({
        cwd: request.cwd,
        file: draftPath,
        content:
          "## The harbour\n<!-- developer -->\n\nGulls circled the quay at dawn.\n\n## The crossing\n<!-- agent -->\n\nThe ferry carried them away at noon.\n",
        message: "Reword The crossing as the escape, review of #1",
      });
    }
    return resultOf({ records });
  };
}

const readerFinding: ReviewFinding = {
  axis: "reader",
  where: `${draftPath}:7`,
  claim:
    'The crossing reads as a delay, not the Outline\'s escape: "The ferry slipped out at noon."',
  suggestedVerdict: "fix",
  reason: "The Outline line says the crossing is the escape.",
};

function pieceReviewed(): StepScript {
  return async () =>
    resultOf({
      findings: [readerFinding],
      dismissedOverlaps: [
        { hit: "the ferry left", reason: "A fixed phrase for the event." },
      ],
    });
}

function passagesPath(): string {
  return join(workspacePath(), ".runner", "passages", "byro-repo-1");
}

// Rewrites The crossing as an agent Section and commits the draft, as a piece implement step would.
function drafted(change: Partial<PieceImplementRecord> = {}): StepScript {
  return async (request) => {
    stepResults.commitFile({
      cwd: request.cwd,
      file: draftPath,
      content:
        "## The harbour\n<!-- developer -->\n\nGulls circled the quay at dawn.\n\n## The crossing\n<!-- agent -->\n\nThe ferry slipped out at noon.\n",
      message: "Draft The crossing in the Agent draft",
    });
    return resultOf({
      record: {
        status: "committed",
        branches: [
          {
            repo: "byro-repo",
            branch: git(request.cwd, "branch", "--show-current"),
            sha: git(request.cwd, "rev-parse", "HEAD"),
          },
        ],
        closingComment: "Drafted The crossing.",
        boxesUndone: [],
        blockers: [],
        sectionsDrafted: ["The crossing"],
        ...change,
      },
    });
  };
}

const blockedDraft: StepScript = async () => ({
  ...resultOf({
    record: {
      status: "blocked",
      branches: [],
      closingComment: "",
      boxesUndone: [],
      blockers: [
        {
          kind: "spec-ambiguity",
          detail: "The logbook gives two tellings of the crossing.",
          recommendation: "Keep the earlier telling.",
        },
      ],
    },
  }),
  sessionId: "implement-session",
  peakContext: 90_000,
});

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
    expect(closing?.comment).toContain(outlineTexts.proposed);
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
    addResearchedSpec();
    const agentStep = FakeAgentStep.init(
      researched(readyRecordOf(scratchFolder())),
    );

    const result = await specRun(agentStep).run(spec);

    expect(result.message).toContain("byro-repo #2 waits on Halt H1");
    expect(haltComments()).toHaveLength(1);
    const [halt] = haltComments();
    expect(halt).toContain("Research Halt");
    expect(halt).toContain("**F1** The ferry carried forty people.");
    expect(halt).toContain(
      `**E1** The crossing: replace "${outlineTexts.old}"`,
    );
    expect(halt).toContain("Blocks: byro-repo#2 and their downstream.");
    expect(ticketState()["byro-repo #1"]?.step).toBe("landed");
    const saved = JSON.parse(readFileSync(runStatePath(), "utf8")) as {
      halts: Halt[];
    };
    expect(saved.halts.map(({ outlineEdits }) => outlineEdits)).toEqual([
      [
        {
          section: "The crossing",
          oldText: outlineTexts.old,
          newText: outlineTexts.proposed,
          reason: "The logbook dates the ferry first.",
        },
      ],
    ]);
  });

  it("clears a dropped fact and leaves an unapproved edit out of the spec", async () => {
    addResearchedSpec();
    await specRun(
      FakeAgentStep.init(researched(readyRecordOf(scratchFolder()))),
    ).run(spec);
    github.reply(spec.number, "H1: drop F1");

    const result = await specRun(FakeAgentStep.init()).run(spec);

    expect(github.issues.get(spec.number)?.body).toBe(outlinedSpecBody);
    expect(result.message).toContain(draftingGoesOn);
  });

  it("raises no Halt on a record with only unwanted facts and no edits", async () => {
    addResearchedSpec();
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
    addResearchedSpec();
    await specRun(
      FakeAgentStep.init(researched(readyRecordOf(scratchFolder()))),
    ).run(spec);
    github.reply(spec.number, "H1: stop spec");

    const result = await specRun(FakeAgentStep.init()).run(spec);

    expect(result.kind).toBe("stopped");
    expect(result.message).not.toContain("stays unlanded");
  });

  it("posts nothing until a wrap-up that stopped lands, then the Halt", async () => {
    addResearchedSpec();
    const primary = primaryOf("byro-repo");
    const origin = git(primary, "remote", "get-url", "origin");
    const record = readyRecordOf(scratchFolder());
    const agentStep = FakeAgentStep.init(async () => {
      git(primary, "remote", "set-url", "origin", "/gone");
      return resultOf({ record });
    });

    const stopped = await specRun(agentStep).run(spec);

    expect(stopped.kind).toBe("stopped");
    expect(haltComments()).toEqual([]);
    git(primary, "remote", "set-url", "origin", origin);

    const result = await specRun(FakeAgentStep.init()).run(spec);

    expect(result.landed).toEqual([refOf(1)]);
    expect(haltComments()).toHaveLength(1);
    expect(result.message).toContain("byro-repo #2 waits on Halt H1");
  });
});

const outlineTexts = {
  old: "the storm came, then the ferry ran.",
  proposed: "the ferry ran before the storm came.",
} as const;
const outlinedSpecBody = `## Deliverable\n\nThe crossing.\n\n## Outline\n\n- **The crossing**: ${outlineTexts.old}\n\n## Facts\n\n- The ferry carried forty people.\n`;

// The drafting ticket isn't ready-for-agent, so it waits on the developer once no Halt holds it.
const draftingGoesOn = "byro-repo #2 waits on you";

// Research ticket #1 blocks drafting ticket #2, which isn't ready-for-agent, so the run launches only the research.
function addResearchedSpec(): void {
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
        oldText: outlineTexts.old,
        newText: outlineTexts.proposed,
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
