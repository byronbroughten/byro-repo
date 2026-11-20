import {
  existsSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import type { StepResult } from "./AgentStep.ts";
import { type DocRead, Docs } from "./Docs.ts";
import type { DocumentChange, FakeDocuments } from "./Docs/FakeDocuments.ts";
import type { GoogleDocument } from "./Docs/googleDocs.ts";
import { FakeAgentStep } from "./FakeAgentStep.ts";
import { git } from "./GitFixture.ts";
import type { Halt } from "./halts.ts";
import { gapCheckOutputSchema } from "./recordSchema.ts";
import { skippedReviewersNote } from "./reviewList.ts";
import { defaultRunKnobs } from "./runKnobs.ts";
import type { RunResult } from "./SpecRun.ts";
import {
  addIssue,
  addSpec,
  commentsOn,
  gapCheckMark,
  github,
  haltComments,
  handoffResultOf,
  heldDocs,
  heldTicketLine,
  holdDocs,
  implemented,
  masterSubjects,
  noticeSummaries,
  outcomeFolder,
  outcomeRowPath,
  primaryOf,
  progressLines,
  refOf,
  resultOf,
  reviewed,
  reviewListOf,
  runStatePath,
  spec,
  specRun,
  type StepScript,
  temp,
  ticketFacts,
  ticketState,
  useSpecRunHarness,
} from "./specRunHarness.ts";
import { pieceDrafts } from "./specRunHarness/pieceDrafts.ts";
import { stepResults } from "./specRunHarness/stepResults.ts";
import { expectNudgeRules } from "./stepPrompts/handoffTextFixture.ts";
import type {
  DismissedOverlap,
  ReadyResearchRecord,
  ResearchRecord,
  ResolveRecord,
} from "./stepRecords.ts";
import { toolsOf } from "./targetTools.ts";

useSpecRunHarness();

const {
  deliverableId,
  docOf,
  documentOf,
  drafted,
  draftPath,
  h2ContentOf,
  lateDraft,
  paragraphOf,
  pieceReviewed,
  readerFinding,
} = pieceDrafts;

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

  it("mirrors the Doc's H1 lines in the Agent draft, with a mark under each", async () => {
    addDraftingSpec();
    holdDocs(headedDocOf(twoPartSections));
    let pulled = "";

    await specRun(
      FakeAgentStep.init(async (request) => {
        pulled = readFileSync(join(request.cwd, draftPath), "utf8");
        return drafted()(request);
      }),
    ).run(spec);

    expect(pulled).toBe(
      "# Part one\n<!-- developer -->\n\n## Intro\n<!-- developer -->\n\nThe quay was quiet.\n\n# Part two\n<!-- developer -->\n\n## Intro\n<!-- developer -->\n\nThe ferry was late.\n",
    );
    expect(ticketState()["byro-repo #1"]?.pullBaseline?.sections).toEqual({
      "Part one": "\n",
      "Part one › Intro": "The quay was quiet.\n",
      "Part two": "\n",
      "Part two › Intro": "The ferry was late.\n",
    });
  });

  it("writes each heading's headingId into its mark, an agent Section's included, at every pull", async () => {
    addDraftingSpec();
    holdDocs(withHeadingIds(headedDocOf(twoPartSections)));
    stepResults.commitFile({
      cwd: primaryOf("byro-repo"),
      file: draftPath,
      content:
        "# Part one\n<!-- developer -->\n\n## Intro\n<!-- agent h.stale -->\n\nThe quay lay quiet.\n\n# Part two\n<!-- developer -->\n\n## Intro\n<!-- developer -->\n\nOlder.\n",
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
      "# Part one\n<!-- developer h.Part-one -->\n\n## Intro\n<!-- agent h.Intro -->\n\nThe quay lay quiet.\n\n# Part two\n<!-- developer h.Part-two -->\n\n## Intro\n<!-- developer h.Intro -->\n\nThe ferry was late.\n",
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
  it("drafts the ticket's Sections after pull, keeps the record, and reviews, resolves, checks and lands it", async () => {
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
    expect(masterSubjects()).toContain("Draft The crossing in the Agent draft");
    expect(ticketState()["byro-repo #1"]?.record).toMatchObject({
      status: "committed",
      sectionsDrafted: ["The crossing"],
    });
    expect(result.landed).toEqual([refOf(1)]);
    expect(ticketState()["byro-repo #1"]?.step).toBe("landed");
    expect(
      git(primaryOf("byro-repo"), "show", `master:${draftPath}`),
    ).toContain("The ferry carried them away at noon.");
  });

  it("launches the implement step telling it to hand off only with a paragraph left to draft, and to propose a split by the work left", async () => {
    addDraftingSpec();
    const agentStep = FakeAgentStep.init(drafted());

    await specRun(agentStep).run(spec);

    const prompt = agentStep.requests[0]?.prompt;
    expectNudgeRules(prompt, "no paragraph is left to draft");
    expect(prompt).toContain(
      "Otherwise finish the paragraph in hand, then stop",
    );
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

  it("halts on a committed record naming a Section the Agent draft lacks", async () => {
    addDraftingSpec();

    await specRun(
      FakeAgentStep.init(drafted({ sectionsDrafted: ["The crosing"] })),
    ).run(spec);

    expect(ticketState()["byro-repo #1"]?.step).toBe("halted");
    expect(haltComments()[0]).toContain("Failure Halt");
    expect(haltComments()[0]).toContain("The crosing");
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
      async (request) => {
        isPassageKept = existsSync(passage);
        return drafted()(request);
      },
      pieceReviewed(),
      pieceResolved([readerFix]),
    );
    let isPassageKept = false;

    await specRun(agentStep).run(spec);

    expect(agentStep.requests).toHaveLength(4);
    expect(agentStep.requests[1]?.prompt).toContain(
      "Handoff from the previous step",
    );
    expect(agentStep.requests[1]?.prompt).toContain(`${passage}:1`);
    expect(agentStep.requests[1]?.prompt).toContain(passagesPath());
    expect(commentsOn(1, "## Handoff")[0]).toContain(`${draftPath}:5-9`);
    expect(isPassageKept).toBe(true);
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

  it("launches with Drive reads of the developer's image files beside the spec's sources", async () => {
    addDraftingSpec();
    github.edit(spec.number, {
      body: `## Deliverable\n\nThe crossing, doc ${deliverableId}.\n\n## Supporting Material\n\n- The lighthouse logbook, ${logbookId}: the storm.\n\n## Images\n\n1. The quay at dawn, by the developer, file ${quayPhotoId}: the empty quay.\n`,
    });
    const agentStep = FakeAgentStep.init(drafted());

    await specRun(agentStep).run(spec);

    expect(agentStep.requests[0]?.targets).toEqual([
      { kind: "source", id: logbookId },
      { kind: "source", id: quayPhotoId },
    ]);
  });

  it("launches with one Drive read of a file the spec names twice", async () => {
    addDraftingSpec();
    github.edit(spec.number, {
      body: `## Deliverable\n\nThe crossing, doc ${deliverableId}.\n\n## Supporting Material\n\n- The lighthouse logbook, ${logbookId}: the storm.\n\n## Images\n\n1. The logbook's storm page, by the developer, file ${logbookId}: the storm.\n2. The quay at dawn, by the developer, file ${quayPhotoId}: the empty quay.\n3. The quay at dusk, by the developer, file ${quayPhotoId}: the empty quay.\n`,
    });
    const agentStep = FakeAgentStep.init(drafted());

    await specRun(agentStep).run(spec);

    expect(agentStep.requests[0]?.targets).toEqual([
      { kind: "source", id: logbookId },
      { kind: "source", id: quayPhotoId },
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
  it("reviews the drafted ticket in the implementer's resumed session, under its schema, with /review-piece's body inlined over the Agent draft and passages folder", async () => {
    addDraftingSpec();
    const agentStep = FakeAgentStep.init(drafted(), pieceReviewed());

    await specRun(agentStep).run(spec);

    const [implementer, review] = agentStep.requests;
    expect(review?.resumeSessionId).toBe("session");
    expect(review?.sessionSchema).toEqual(implementer?.sessionSchema);
    expect(review?.prompt).toContain("your own work");
    expect(review?.prompt).toContain("as its reviewer worded it");
    expect(review?.prompt).toContain(heldTicketLine);
    expect(review?.logPath).toMatch(/byro-repo-1-\d+-review\.jsonl$/);
    expect(review?.prompt).toContain(
      '<skill name="review-piece">\nThree-axis review of a Piece\'s Agent draft. Read [the rules](docs/pieces/rules.md).\n</skill>',
    );
    expect(review?.prompt).not.toContain("SKILL.md");
    expect(review?.prompt).not.toContain("Skill tool");
    expect(review?.prompt).toContain(draftPath);
    expect(review?.prompt).toContain(passagesPath());
  });

  describe("the inputs /review-piece copies word for word", () => {
    const inputsFolder = (): string =>
      join(workspacePath(), ".runner", "review-inputs", "byro-repo-1");
    const fieldedBody = `## Deliverable\n\nThe crossing, doc ${deliverableId}.\n\n## Reader\n\nA ferry passenger who missed the boat.\n\n## Style\n\nEvidence: firsthand · Formality: general\n\n- Keep the gulls.\n\n## Form\n\nLength: 300 words\nCut the harbour first.\n\n## Images\n\n1. The quay at dawn, a photo.\n2. The ferry's route, a map.\n\n## Outline\n\n- The harbour: dawn.\n- The crossing: the escape.\n`;
    // The harness's overlapping draft, with one Image placeholder naming a file in each Section and one listing facts.
    const imagedDraft =
      "## The harbour\n<!-- developer -->\n\nGulls circled the quay at dawn.\n\n\\[Image 1: quay-dawn.png\\]\n\n## The crossing\n<!-- agent -->\n\nThe ferry slipped out at noon.\n\n\\[Image 2: ferry-route.PNG\\]\n\n\\[Image 3: The ferry's route, from the quay to the far shore\\]\n";
    const imageFolder = (): string =>
      join(workspacePath(), "writing", "agent-drafts", "213");

    function addFieldedSpec(body = fieldedBody): void {
      addDraftingSpec();
      github.subIssues.set(spec.number, [1, 2]);
      addIssue(2, { labels: ["research"] });
      github.edit(2, { isOpen: false });
      github.edit(spec.number, { body });
    }

    // Reads each supplied file as the review step finds it at launch.
    function reviewReading(seen: Record<string, string>): StepScript {
      return async (request) => {
        for (const file of [
          "reader.md",
          "outline.md",
          "length-limit.md",
          "style.md",
          "images.md",
          "unverified.md",
          "overlap.txt",
        ]) {
          const path = join(inputsFolder(), file);
          if (existsSync(path)) seen[file] = readFileSync(path, "utf8");
        }
        seen.prompt = request.prompt ?? "";
        return pieceReviewed()(request);
      };
    }

    it("writes each before launch, names it in the prompt, and leaves it uncommitted", async () => {
      addFieldedSpec();
      await github.comment(
        refOf(2),
        "## Facts\n\n- The ferry left at noon.\n\n## Unverified\n\n- The gulls were herring gulls: no source.\n",
      );
      const seen: Record<string, string> = {};

      await specRun(
        FakeAgentStep.init(drafted({}, imagedDraft), reviewReading(seen)),
      ).run(spec);

      expect(seen["reader.md"]).toBe(
        "A ferry passenger who missed the boat.\n",
      );
      expect(seen["outline.md"]).toBe(
        "- The harbour: dawn.\n- The crossing: the escape.\n",
      );
      expect(seen["length-limit.md"]).toBe("Length: 300 words\n");
      expect(seen["style.md"]).toBe(
        "Evidence: firsthand\nFormality: general\nAcademic: no\n\n## Overrides\n\n- Keep the gulls.\n\n### Form\n\nLength: 300 words\nCut the harbour first.\n",
      );
      expect(seen["unverified.md"]).toBe(
        "- The gulls were herring gulls: no source.\n",
      );
      expect(seen["images.md"]).toBe(
        `1. The quay at dawn, a photo.\n2. The ferry's route, a map.\n\n## Image files\n\n- ${join(imageFolder(), "quay-dawn.png")}\n- ${join(imageFolder(), "ferry-route.PNG")}\n`,
      );
      expect(seen["overlap.txt"]).toContain(
        '1. "the ferry slipped out" (4 words), logbook.txt',
      );
      for (const file of [
        "reader.md",
        "outline.md",
        "images.md",
        "overlap.txt",
      ]) {
        expect(seen.prompt).toContain(join(inputsFolder(), file));
      }
      expect(seen.prompt).toContain(join(inputsFolder(), "overlap-allow.txt"));
      expect(seen.prompt).toContain(
        "The Overlap allow file lists no terms, so the spec reviewer judges overlap hits on proper names and fixed terms as Dismissed overlaps.",
      );
      expect(git(workspacePath(), "status", "--porcelain")).toBe("");
    });

    it("says which the spec lacks rather than naming an empty file", async () => {
      addFieldedSpec(
        `## Deliverable\n\nThe crossing, doc ${deliverableId}.\n\n## Outline\n\n- The crossing: the escape.\n`,
      );
      const seen: Record<string, string> = {};

      await specRun(FakeAgentStep.init(drafted(), reviewReading(seen))).run(
        spec,
      );

      expect(seen["outline.md"]).toBe("- The crossing: the escape.\n");
      expect(seen["reader.md"]).toBeUndefined();
      expect(seen["unverified.md"]).toBeUndefined();
      expect(seen["images.md"]).toBeUndefined();
      expect(seen.prompt).toContain(
        "No Images file: the spec has no `## Images` field.",
      );
      expect(seen.prompt).toContain(
        "No Reader file: the spec has no `## Reader` field.",
      );
      expect(seen.prompt).toContain("No Length limit file:");
      expect(seen.prompt).toContain("No Style file:");
      expect(seen.prompt).toContain("No Unverified file:");
    });

    it("leaves a Style field it can't read to the review, rather than calling it absent", async () => {
      addFieldedSpec(
        `## Deliverable\n\nThe crossing, doc ${deliverableId}.\n\n## Style\n\nPlain and firsthand.\n\n- Keep the gulls.\n`,
      );
      const seen: Record<string, string> = {};

      await specRun(FakeAgentStep.init(drafted(), reviewReading(seen))).run(
        spec,
      );

      expect(seen["style.md"]).toBeUndefined();
      expect(seen.prompt).not.toContain("Style file");
    });
  });

  it("keeps a record's reader finding", async () => {
    addDraftingSpec();

    await specRun(FakeAgentStep.init(drafted(), pieceReviewed())).run(spec);

    expect(ticketState()["byro-repo #1"]?.findings).toEqual([readerFinding]);
  });

  it("halts on a review record with no dismissedOverlaps", async () => {
    addDraftingSpec();
    const noOverlaps = async () => ({
      ...resultOf({ findings: [readerFinding] }),
      spawnedSubagentCount: 3,
    });

    await specRun(FakeAgentStep.init(drafted(), noOverlaps)).run(spec);

    expect(ticketState()["byro-repo #1"]?.step).toBe("halted");
    expect(haltComments()[0]).toContain("Failure Halt");
    expect(haltComments()[0]).toContain("dismissedOverlaps");
  });

  it("never offers inline review, resuming a one-file review that spawned no reviewers once, telling it to spawn all three", async () => {
    addDraftingSpec();
    const agentStep = FakeAgentStep.init(
      drafted(),
      pieceReviewedInline(),
      pieceReviewed([], [slippedOutDismissed]),
    );

    const result = await specRun(agentStep).run(spec);

    expect(result.landed).toEqual([refOf(1)]);
    const [implementer, review, resumed] = agentStep.requests;
    expect(review?.prompt).not.toContain("may review it inline");
    expect(resumed?.resumeSessionId).toBe("review-session");
    expect(resumed?.sessionSchema).toEqual(implementer?.sessionSchema);
    expect(resumed?.prompt).toContain(
      'spec, standards and reader reviewers, as the "review-piece" skill says',
    );
    expect(reviewListOf(1)).toBeUndefined();
  });

  it("records a second skip, showing on the review list that the review ran without its reviewers", async () => {
    addDraftingSpec();
    const agentStep = FakeAgentStep.init(drafted(), pieceReviewedInline(), {
      ...pieceReviewedInline(),
      spawnedSubagentCount: 2,
    });

    const result = await specRun(agentStep).run(spec);

    expect(result.landed).toEqual([refOf(1)]);
    expect(agentStep.requests).toHaveLength(3);
    expect(reviewListOf(1)).toContain(skippedReviewersNote);
    expect(progressLines().join("\n")).toContain(
      "once resumed, spawned 2 of its 3 reviewer subagents",
    );
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

    const [, review, resolver] = agentStep.requests;
    expect(review?.resumeSessionId).toBe("implement-session");
    expect(resolver?.resumeSessionId).toBe("session");
    expect(resolver?.prompt).toContain("`## Piece findings`");
    expect(resolver?.prompt).toContain(draftPath);
    expect(resolver?.prompt).toContain(passagesPath());
    const subjects = masterSubjects();
    const drafting = subjects.indexOf("Draft The crossing in the Agent draft");
    expect(subjects[drafting - 1]).toBe(
      "Reword The crossing as the escape, review of #1",
    );
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

  it("has the resolver rerun the overlap command after its Fixes, listing review's dismissed hits", async () => {
    addDraftingSpec();
    const agentStep = FakeAgentStep.init(
      drafted(),
      pieceReviewed(),
      pieceResolved([readerFix]),
    );

    await specRun(agentStep).run(spec);

    const resolver = agentStep.requests[2]?.prompt;
    expect(resolver).toContain(`--deliverable`);
    expect(resolver).toContain(`--passages ${passagesPath()}`);
    expect(resolver).toContain(
      "- the ferry left: A fixed phrase for the event.",
    );
    expect(resolver).toContain("Propose `decision`");
    expect(resolver).toContain("never leave the checks red");
  });

  it("says review dismissed no hit when it dismissed none", async () => {
    addDraftingSpec();
    const agentStep = FakeAgentStep.init(
      drafted({}, lateDraft),
      pieceReviewed([readerFinding], []),
      pieceResolved([readerFix]),
    );

    await specRun(agentStep).run(spec);

    expect(agentStep.requests[2]?.prompt).toContain(
      "Review dismissed no overlap hit.",
    );
  });
});

describe("a final-pass ticket on a piece spec", () => {
  it.each([
    ["implement", 0],
    ["review", 1],
    ["resolve", 2],
  ])("scopes the %s prompt to every agent Section", async (_step, index) => {
    addDraftingSpec();
    github.edit(1, { labels: ["ready-for-agent", "final-pass"] });
    const agentStep = FakeAgentStep.init(
      drafted({}, lateDraft),
      pieceReviewed(),
      pieceResolved([readerFix]),
    );

    await specRun(agentStep).run(spec);

    expect(agentStep.requests[index]?.prompt).toContain(finalPassScope);
  });

  it.each([
    ["implement", 0],
    ["review", 1],
    ["resolve", 2],
  ])(
    "leaves the %s prompt to the ticket's Sections on any other ticket",
    async (_step, index) => {
      addDraftingSpec();
      const agentStep = FakeAgentStep.init(
        drafted({}, lateDraft),
        pieceReviewed(),
        pieceResolved([readerFix]),
      );

      await specRun(agentStep).run(spec);

      expect(agentStep.requests[index]?.prompt).not.toContain(finalPassScope);
    },
  );
});

const finalPassScope = "every Section marked `<!-- agent -->`";

describe("checks and wrap-up on a piece spec's drafting ticket", () => {
  const slippedOut = '1. "the ferry slipped out" (4 words), logbook.txt';

  it("sends an overlap hit review didn't dismiss to the red-checks step once, over the Agent draft and passages folder", async () => {
    addDraftingSpec();
    const agentStep = FakeAgentStep.init(
      drafted(),
      pieceReviewed([], []),
      stillRed,
    );

    await specRun(agentStep).run(spec);

    expect(agentStep.requests).toHaveLength(3);
    const redChecks = agentStep.requests[2]?.prompt;
    expect(redChecks).toContain("red-checks step");
    expect(redChecks).toContain(draftPath);
    expect(redChecks).toContain(passagesPath());
    expect(redChecks).toContain(slippedOut);
  });

  it("raises a Failure Halt on an overlap hit still red after the red-checks step, leaving it unlanded", async () => {
    addDraftingSpec();

    const result = await specRun(
      FakeAgentStep.init(drafted(), pieceReviewed([], []), stillRed),
    ).run(spec);

    expect(result.landed).toEqual([]);
    expect(ticketState()["byro-repo #1"]?.step).toBe("halted");
    const [halt] = haltComments();
    expect(halt).toContain("Failure Halt");
    expect(halt).toContain("still red after 1 resume(s)");
    expect(halt).toContain(slippedOut);
  });

  it("lands a red-checks fix that clears the hit", async () => {
    addDraftingSpec();
    const rewords: StepScript = async (request) => {
      stepResults.commitFile({
        cwd: request.cwd,
        file: draftPath,
        content: lateDraft,
        message: "Reword the copied run in The crossing, for #1",
      });
      return resultOf({ summary: "Reworded the copied run." });
    };

    const result = await specRun(
      FakeAgentStep.init(drafted(), pieceReviewed([], []), rewords),
    ).run(spec);

    expect(result.landed).toEqual([refOf(1)]);
    expect(
      git(primaryOf("byro-repo"), "show", `master:${draftPath}`),
    ).toContain("The ferry left late.");
  });

  it.each([
    ["its whole line", slippedOut],
    ["its quoted run", '"the ferry slipped out"'],
    ["its bare run", "The ferry slipped out"],
  ])("passes a hit review dismissed by %s, and lands", async (_named, hit) => {
    addDraftingSpec();

    const result = await specRun(
      FakeAgentStep.init(
        drafted(),
        pieceReviewed([], [{ hit, reason: "A fixed phrase for the event." }]),
      ),
    ).run(spec);

    expect(result.landed).toEqual([refOf(1)]);
  });

  it("ignores a hit in a developer's Section", async () => {
    addDraftingSpec();
    const draft =
      "## The harbour\n<!-- developer -->\n\nThe gulls slipped out at dawn.\n\n## The crossing\n<!-- agent -->\n\nThe ferry left late.\n";

    const result = await specRun(
      FakeAgentStep.init(drafted({}, draft), pieceReviewed([], [])),
    ).run(spec);

    expect(result.landed).toEqual([refOf(1)]);
  });

  it.each([
    ["checks", ["final-pass"], false],
    ["leaves out", [], true],
  ] as const)(
    "%s an earlier agent Section on a ticket labelled %j",
    async (_named, labels, isLanded) => {
      addDraftingSpec();
      github.edit(1, { labels: ["ready-for-agent", ...labels] });

      const result = await specRun(
        FakeAgentStep.init(
          drafted({}, earlierAgentDraft),
          pieceReviewed([], []),
          stillRed,
        ),
      ).run(spec);

      expect(result.landed).toEqual(isLanded ? [refOf(1)] : []);
      expect(haltComments().join("\n")).toContain(isLanded ? "" : slippedOut);
    },
  );

  it.each([
    ["a final-pass ticket with a `Length:` line", ["final-pass"], true, true],
    [
      "a final-pass ticket with no `Length:` line",
      ["final-pass"],
      false,
      false,
    ],
    ["a ticket short of the whole draft", [], true, false],
  ] as const)(
    "checks the length only on %s",
    async (_named, labels, hasLengthLine, isChecked) => {
      addDraftingSpec();
      const form = hasLengthLine
        ? "\n## Form\n\nAn essay.\nLength: 5 words\n"
        : "";
      github.edit(spec.number, {
        body: `## Deliverable\n\nThe crossing, doc ${deliverableId}.\n${form}`,
      });
      github.edit(1, { labels: ["ready-for-agent", ...labels] });

      const result = await specRun(
        FakeAgentStep.init(
          drafted({}, lateDraft),
          pieceReviewed([], []),
          stillRed,
        ),
      ).run(spec);

      const halts = haltComments().filter((halt) =>
        halt.includes("over the 5 words"),
      );
      expect(halts).toHaveLength(isChecked ? 1 : 0);
      expect(result.landed).toEqual(isChecked ? [] : [refOf(1)]);
    },
  );

  it("raises a Failure Halt on a wrap-up conflict, with no merge-master step", async () => {
    addDraftingSpec();
    const conflicting: StepScript = async (request) => {
      stepResults.commitFile({
        cwd: primaryOf("byro-repo"),
        file: draftPath,
        content: "## The crossing\n<!-- developer -->\n\nThe ferry sank.\n",
        message: "Edit the Agent draft on master",
      });
      return drafted({}, lateDraft)(request);
    };

    const result = await specRun(
      FakeAgentStep.init(conflicting, pieceReviewed([], [])),
    ).run(spec);

    expect(result.landed).toEqual([]);
    expect(ticketState()["byro-repo #1"]?.step).toBe("halted");
    const [halt] = haltComments();
    expect(halt).toContain("Failure Halt");
    expect(halt).toContain(
      "The wrap-up conflicts with master, and the piece Workflow has no merge-master step",
    );
  });
});

describe("the end of a piece spec", () => {
  const judgeThenRerun = "judge, then rerun";
  const gap = {
    ask: "Story 3: the harbour at dusk",
    evidence: "No Section of the Agent draft sets the harbour at dusk.",
    recommendation: "Draft it in a further ticket.",
    draftIssueTitle: "Draft the harbour at dusk",
  };

  // One drafting ticket and the Edit gate, a ready-for-human ticket the developer takes.
  function addGatedSpec(gateLabels = ["ready-for-human"]): void {
    addDraftingSpec();
    github.subIssues.set(spec.number, [1, 2]);
    addIssue(2, { labels: gateLabels });
  }

  async function landsThenGapChecks(
    gaps: object[],
    draft: StepScript = drafted({}, lateDraft),
  ): Promise<{ result: RunResult; agentStep: FakeAgentStep }> {
    const agentStep = FakeAgentStep.init(
      draft,
      pieceReviewed([], []),
      async () => resultOf({ gaps }),
    );
    const result = await specRun(agentStep, { agentStep }).run(spec);
    return { result, agentStep };
  }

  it("runs the piece gap check, writing nothing, once every ticket but the Edit gate has landed, and posts its gaps as the last review list", async () => {
    addGatedSpec();

    const { agentStep } = await landsThenGapChecks([gap]);

    const gapCheck = agentStep.requests.at(-1);
    expect(gapCheck?.jsonSchema).toBe(gapCheckOutputSchema);
    expect(gapCheck?.targets).toEqual([]);
    expect(gapCheck?.prompt).toContain("only what no review checks");
    expect(gapCheck?.prompt).toContain("Change nothing");
    const [list] = commentsOn(spec.number, gapCheckMark);
    expect(list).toContain(gap.ask);
  });

  it("holds the gap check while a drafting ticket still waits on the developer", async () => {
    addGatedSpec([]);

    const { agentStep } = await landsThenGapChecks([]);

    expect(agentStep.requests).toHaveLength(2);
    expect(commentsOn(spec.number, gapCheckMark)).toEqual([]);
  });

  it(`ends with "${judgeThenRerun}" while a review-list item is undecided`, async () => {
    addGatedSpec();

    const { result } = await landsThenGapChecks([gap]);

    expect(result.kind).toBe("stopped");
    expect(result.message).toContain(
      "The review lists hold undecided items: judge, then rerun: `npm run runner -- byronbroughten/byro-repo 213`.",
    );
  });

  it("goes on to the Edit gate once every item is decided", async () => {
    addGatedSpec();

    const { result } = await landsThenGapChecks([]);

    expect(result.kind).toBe("finished");
    expect(result.message).toContain("byro-repo #2 waits on you");
    expect(result.message).not.toContain(judgeThenRerun);
  });

  it("goes on to the Edit gate on the rerun once the developer decides the undecided item", async () => {
    addGatedSpec();
    await landsThenGapChecks([gap]);
    const list = github.comments.find(({ body }) =>
      body.includes(gapCheckMark),
    );
    if (list === undefined) throw new Error("No gap-check review list.");
    list.body = list.body.replace("- [ ] **R", "- [x] **R");

    const agentStep = FakeAgentStep.init();
    const result = await specRun(agentStep, { agentStep }).run(spec);

    expect(agentStep.requests).toEqual([]);
    expect(result.kind).toBe("finished");
    expect(result.message).toContain("byro-repo #2 waits on you");
    expect(result.message).not.toContain(judgeThenRerun);
  });

  describe("the push", () => {
    const pushedSections = {
      "The harbour": "The gulls lifted off the quay.\n",
      "The crossing": "The ferry carried them away at noon.\n",
    };
    // Both Sections the agents', so the push writes each.
    const agentOnlyDraft = drafted(
      {},
      Object.entries(pushedSections)
        .map(([heading, text]) => `## ${heading}\n<!-- agent -->\n\n${text}`)
        .join("\n"),
    );
    const pulledSections = {
      "The harbour": "Gulls circled the quay at dawn.",
      "The crossing": "The ferry left late.",
    };
    const pulledDoc = docOf(pulledSections);

    async function deliverableOf(): Promise<DocRead> {
      return Docs.init(heldDocs()).read(deliverableId);
    }

    // Edits The crossing in the Doc, as the developer would between the pull and the push.
    function editsTheCrossing(script: StepScript): StepScript {
      return async (request) => {
        heldDocs().edit(deliverableId, () => ({
          ...docOf({
            ...pulledSections,
            "The crossing": "The ferry never came.",
          }),
          revisionId: "crossing-2",
        }));
        return script(request);
      };
    }

    it("writes every agent Section into the Deliverable and ends at the Edit gate", async () => {
      addGatedSpec();

      const { result } = await landsThenGapChecks([], agentOnlyDraft);

      expect(Object.fromEntries((await deliverableOf()).sections)).toEqual(
        pushedSections,
      );
      expect(result.kind).toBe("finished");
      expect(result.message).toContain("byro-repo #2 waits on you");
    });

    it("ends naming the Deliverable's Doc and the command that closes out the Edit gate, in its message and notice", async () => {
      addGatedSpec();

      const { result } = await landsThenGapChecks([], agentOnlyDraft);

      const gateLine = `Edit the Deliverable in its Doc, https://docs.google.com/document/d/${deliverableId}/edit, then close out the Edit gate: \`/close-project byro-repo ${spec.number}\`.`;
      expect(result.message).toContain(gateLine);
      expect(noticeSummaries().at(-1)).toContain(gateLine);
    });

    it("writes nothing while a review-list item is undecided", async () => {
      addGatedSpec();

      await landsThenGapChecks([gap], agentOnlyDraft);

      expect((await deliverableOf()).revisionId).toBe("crossing-1");
    });

    it("pushes once, so a developer's edit after the push stays on a rerun", async () => {
      addGatedSpec();
      await landsThenGapChecks([], agentOnlyDraft);
      heldDocs().edit(deliverableId, () => ({
        ...pulledDoc,
        revisionId: "edited",
      }));

      const result = await specRun(FakeAgentStep.init()).run(spec);

      expect((await deliverableOf()).revisionId).toBe("edited");
      expect(result.message).toContain("byro-repo #2 waits on you");
    });

    describe("a Section whose heading the developer renamed or moved after the pull", () => {
      const idDraft = drafted(
        {},
        Object.entries(pushedSections)
          .map(
            ([heading, text]) =>
              `## ${heading}\n<!-- agent ${headingIdOf(heading)} -->\n\n${text}`,
          )
          .join("\n"),
      );

      // Lands the drafting ticket, the Doc changed by `edit` while its step runs.
      async function landsAfter(
        edit: (documents: FakeDocuments) => void,
      ): Promise<void> {
        addGatedSpec();
        holdDocs(withHeadingIds(docOf(pulledSections)));
        await landsThenGapChecks([], async (request) => {
          edit(heldDocs());
          return idDraft(request);
        });
      }

      it("writes a renamed Section in place, found by its headingId", async () => {
        await landsAfter((documents) =>
          documents.editHeading(deliverableId, "h.The-crossing", {
            text: "The voyage",
          }),
        );

        expect(Object.fromEntries((await deliverableOf()).sections)).toEqual({
          "The harbour": pushedSections["The harbour"],
          "The voyage": pushedSections["The crossing"],
        });
      });

      it("writes each Section in place after a heading moves to another level", async () => {
        await landsAfter((documents) =>
          documents.editHeading(deliverableId, "h.The-harbour", {
            namedStyleType: "HEADING_1",
          }),
        );

        expect(Object.fromEntries((await deliverableOf()).sections)).toEqual({
          "The harbour": pushedSections["The harbour"],
          "The harbour › The crossing": pushedSections["The crossing"],
        });
      });

      it("raises the push Halt on a renamed Section whose text changed since the pull", async () => {
        await landsAfter((documents) =>
          documents
            .edit(deliverableId, () =>
              withHeadingIds(
                docOf({
                  ...pulledSections,
                  "The crossing": "The ferry never came.",
                }),
              ),
            )
            .editHeading(deliverableId, "h.The-crossing", {
              text: "The voyage",
            }),
        );

        const [halt] = haltComments();
        expect(halt).toContain('"The crossing" changed in the Doc since');
        expect((await deliverableOf()).sections.get("The voyage")).toBe(
          "The ferry never came.\n",
        );
      });
    });

    describe("a Deliverable whose H2s repeat under different H1s", () => {
      const twoPartDraft =
        "# Part one\n<!-- developer -->\n\n## Intro\n<!-- developer -->\n\nThe quay was quiet.\n\n# Part two\n<!-- developer -->\n\n## Intro\n<!-- agent -->\n\nThe ferry came at noon.\n";
      const twoPartDrafted = drafted(
        { sectionsDrafted: ["Part two › Intro"] },
        twoPartDraft,
      );

      function addTwoPartSpec(
        parts: Record<string, Record<string, string>> = twoPartSections,
      ): void {
        addGatedSpec();
        holdDocs(headedDocOf(parts));
      }

      it("writes each agent Section under its own H1", async () => {
        addTwoPartSpec();

        await landsThenGapChecks([], twoPartDrafted);

        expect(Object.fromEntries((await deliverableOf()).sections)).toEqual({
          "Part one": "\n",
          "Part one › Intro": "The quay was quiet.\n",
          "Part two": "\n",
          "Part two › Intro": "The ferry came at noon.\n",
        });
      });

      it("names a changed Section by its full heading path in its push Halt", async () => {
        addTwoPartSpec();

        await landsThenGapChecks([], async (request) => {
          heldDocs().edit(deliverableId, () => ({
            ...headedDocOf({
              ...twoPartSections,
              "Part two": { Intro: "The ferry never came." },
            }),
            revisionId: "intro-2",
          }));
          return twoPartDrafted(request);
        });

        const [halt] = haltComments();
        expect(halt).toContain('"Part two › Intro" changed in the Doc since');
      });

      it("names the H1 to add a missing H2 under in its push Halt", async () => {
        addTwoPartSpec({ ...twoPartSections, "Part two": {} });

        await landsThenGapChecks([], twoPartDrafted);

        const [halt] = haltComments();
        expect(halt).toContain('The Doc has no "Part two › Intro" Section');
        expect(halt).toContain(
          'Add an H2 "Intro" under the H1 "Part two", adding that H1 first if the Doc has none, then answer `overwrite`',
        );
      });
    });

    describe("its Halt on a Section the developer changed", () => {
      const pushHaltHead =
        '**Halt H1** · Halt 1 of 1 · byro-repo #213, "The spec" · Push Halt';
      const keptMark =
        'Mark "The crossing" as the developer\'s in the Agent draft of byro-repo #213, for #213';

      // Lands the drafting ticket with The crossing changed in the Doc, so the push raises H1 on it.
      async function haltsOnTheCrossing(): Promise<void> {
        addGatedSpec();
        await landsThenGapChecks([], editsTheCrossing(agentOnlyDraft));
      }

      // Edits both Sections in the Doc, so the push raises H1 on The harbour and H2 on The crossing.
      function editsBoth(script: StepScript): StepScript {
        return async (request) => {
          heldDocs().edit(deliverableId, () => ({
            ...docOf({
              "The harbour": "The gulls were gone.",
              "The crossing": "The ferry never came.",
            }),
            revisionId: "both-2",
          }));
          return script(request);
        };
      }

      async function answersThenReruns(answer: string): Promise<RunResult> {
        await haltsOnTheCrossing();
        github.reply(spec.number, `H1: ${answer}`);
        return specRun(FakeAgentStep.init()).run(spec);
      }

      // Without its last newline, which the git fixture trims.
      function masterDraft(): string {
        return git(primaryOf("byro-repo"), "show", `master:${draftPath}`);
      }

      it("raises a push Halt on the spec issue naming the Section, answered `overwrite` or `keep mine`, writing nothing", async () => {
        await haltsOnTheCrossing();

        expect((await deliverableOf()).revisionId).toBe("crossing-2");
        const [halt] = haltComments();
        expect(halt).toContain(pushHaltHead);
        expect(halt).toContain('"The crossing" changed in the Doc since');
        expect(halt).toContain("1. `overwrite`\n2. `keep mine`");
        expect(noticeSummaries()).toContainEqual(
          expect.stringContaining(
            "Idle: nothing runnable. The push waits on Halt H1;",
          ),
        );
      });

      it("holds the spec-end Steps while the Halt is open, raising it once", async () => {
        await haltsOnTheCrossing();

        const result = await specRun(FakeAgentStep.init()).run(spec);

        expect(haltComments()).toHaveLength(1);
        expect((await deliverableOf()).revisionId).toBe("crossing-2");
        expect(result.message).toContain("The push waits on Halt H1");
      });

      it("writes the agent text over the Doc's on `overwrite`", async () => {
        const result = await answersThenReruns("overwrite");

        expect(Object.fromEntries((await deliverableOf()).sections)).toEqual(
          pushedSections,
        );
        expect(result.kind).toBe("finished");
        expect(result.message).toContain("byro-repo #2 waits on you");
      });

      it("leaves the Doc's text on `keep mine` and marks the Section as the developer's, landed on master", async () => {
        const result = await answersThenReruns("keep mine");

        expect(Object.fromEntries((await deliverableOf()).sections)).toEqual({
          "The harbour": pushedSections["The harbour"],
          "The crossing": "The ferry never came.\n",
        });
        expect(masterDraft()).toBe(
          "## The harbour\n<!-- agent -->\n\nThe gulls lifted off the quay.\n\n## The crossing\n<!-- developer -->\n\nThe ferry never came.",
        );
        expect(masterSubjects()).toContain(keptMark);
        expect(github.issues.get(spec.number)?.isOpen).toBe(true);
        expect(result.message).toContain("byro-repo #2 waits on you");
      });

      it("writes nothing twice on a rerun after both answers", async () => {
        addGatedSpec();
        const bothEdited = editsBoth(agentOnlyDraft);
        await landsThenGapChecks([], bothEdited);
        github.reply(spec.number, "H1: overwrite");
        github.reply(spec.number, "H2: keep mine");
        await specRun(FakeAgentStep.init()).run(spec);
        const pushed = await deliverableOf();

        const rerun = await specRun(FakeAgentStep.init()).run(spec);

        expect((await deliverableOf()).revisionId).toBe(pushed.revisionId);
        expect(Object.fromEntries(pushed.sections)).toEqual({
          "The harbour": pushedSections["The harbour"],
          "The crossing": "The ferry never came.\n",
        });
        expect(
          masterSubjects().filter((subject) => subject === keptMark),
        ).toHaveLength(1);
        expect(haltComments()).toHaveLength(2);
        expect(rerun.message).toContain("byro-repo #2 waits on you");
      });

      it("raises the Halt on every agent Section of a spec with no recorded baseline, writing nothing", async () => {
        addGatedSpec();
        await landsThenGapChecks([gap], agentOnlyDraft);
        const saved = JSON.parse(readFileSync(runStatePath(), "utf8")) as {
          tickets: Record<string, { pullBaseline?: unknown }>;
        };
        for (const state of Object.values(saved.tickets)) {
          delete state.pullBaseline;
        }
        writeFileSync(runStatePath(), JSON.stringify(saved));
        const list = github.comments.find(({ body }) =>
          body.includes(gapCheckMark),
        );
        if (list === undefined) throw new Error("No gap-check review list.");
        list.body = list.body.replace("- [ ] **R", "- [x] **R");

        await specRun(FakeAgentStep.init()).run(spec);

        expect((await deliverableOf()).revisionId).toBe("crossing-1");
        const halts = haltComments();
        expect(halts).toHaveLength(2);
        expect(halts[0]).toContain('"The harbour" changed in the Doc since');
        expect(halts[1]).toContain('"The crossing" changed in the Doc since');
      });

      it("asks to add a missing Section's heading, then answer `overwrite`, which writes it", async () => {
        addGatedSpec();
        await landsThenGapChecks(
          [],
          drafted(
            {},
            `${lateDraft}\n## The return\n<!-- agent -->\n\nThey came home by train.\n`,
          ),
        );
        const [halt] = haltComments();
        heldDocs().edit(deliverableId, () => ({
          ...docOf({ ...pulledSections, "The return": "" }),
          revisionId: "return-added",
        }));
        github.reply(spec.number, "H1: overwrite");

        const result = await specRun(FakeAgentStep.init()).run(spec);

        expect(halt).toContain('The Doc has no "The return" Section');
        expect(halt).toContain(
          'Add its "The return" heading, then answer `overwrite`',
        );
        expect((await deliverableOf()).sections.get("The return")).toBe(
          "They came home by train.\n",
        );
        expect(result.message).toContain("byro-repo #2 waits on you");
      });
    });

    describe("an edit between its read and its write", () => {
      // A comment changes the revision but no Section.
      const comments: DocumentChange = (document) => ({
        ...document,
        revisionId: `${document.revisionId}-commented`,
      });
      const pushStopped = `The push stopped on Doc ${deliverableId}, which changed between its read and its write 4 times running. Rerun to retry it: \`npm run runner -- byronbroughten/byro-repo 213\`.`;

      it("reads and compares the Doc again on a stale revision, then writes the Sections still to write", async () => {
        addGatedSpec();
        heldDocs().editBeforeUpdate(comments, { skipped: 1 });

        const { result } = await landsThenGapChecks([], agentOnlyDraft);

        const pushed = await deliverableOf();
        expect(Object.fromEntries(pushed.sections)).toEqual(pushedSections);
        expect(pushed.revisionId).toBe(`${deliverableId}-written-2`);
        expect(result.message).toContain("byro-repo #2 waits on you");
      });

      it("raises the push Halt on a Section the edit changed, never writing over it blind", async () => {
        addGatedSpec();
        heldDocs().editBeforeUpdate(() => ({
          ...docOf({
            ...pulledSections,
            "The crossing": "The ferry never came.",
          }),
          revisionId: "crossing-mid-push",
        }));

        await landsThenGapChecks([], agentOnlyDraft);

        const pushed = await deliverableOf();
        expect(pushed.revisionId).toBe("crossing-mid-push");
        expect(pushed.sections.get("The crossing")).toBe(
          "The ferry never came.\n",
        );
        const [halt] = haltComments();
        expect(halt).toContain('"The crossing" changed in the Doc since');
      });

      it("stops the run past the retry bound, and a rerun retries", async () => {
        addGatedSpec();
        heldDocs().editBeforeUpdate(comments, { times: 4 });

        const { result } = await landsThenGapChecks([], agentOnlyDraft);
        const rerun = await specRun(FakeAgentStep.init()).run(spec);

        expect(result.kind).toBe("stopped");
        expect(result.message).toContain(pushStopped);
        expect(Object.fromEntries((await deliverableOf()).sections)).toEqual(
          pushedSections,
        );
        expect(rerun.kind).toBe("finished");
      });
    });

    describe("its Halt on pending suggestions", () => {
      const suggestionsHalt = `Doc ${deliverableId} holds pending suggestions`;

      // Suggests a word in The harbour, as a reader of the Doc would.
      function suggestsInTheHarbour(script: StepScript): StepScript {
        return async (request) => {
          heldDocs().edit(deliverableId, () => {
            const suggested = docOf(pulledSections);
            suggested.body?.content.splice(2, 1, {
              paragraph: {
                elements: [
                  { textRun: { content: "Gulls circled" } },
                  {
                    textRun: {
                      content: " slowly",
                      suggestedInsertionIds: ["suggest.1"],
                    },
                  },
                  { textRun: { content: " the quay at dawn.\n" } },
                ],
                paragraphStyle: { namedStyleType: "NORMAL_TEXT" },
              },
            });
            return { ...suggested, revisionId: "suggested" };
          });
          return script(request);
        };
      }

      it("raises a push Halt naming the Doc, answered `continue`, writing nothing", async () => {
        addGatedSpec();

        await landsThenGapChecks([], suggestsInTheHarbour(agentOnlyDraft));

        expect((await deliverableOf()).revisionId).toBe("suggested");
        const [halt] = haltComments();
        expect(halt).toContain("Push Halt");
        expect(halt).toContain(suggestionsHalt);
        expect(halt).toContain("1. `continue`");
      });

      it("writes every agent Section on `continue` once the suggestions are settled", async () => {
        addGatedSpec();
        await landsThenGapChecks([], suggestsInTheHarbour(agentOnlyDraft));
        heldDocs().edit(deliverableId, () => ({
          ...pulledDoc,
          revisionId: "settled",
        }));
        github.reply(spec.number, "H1: continue");

        const result = await specRun(FakeAgentStep.init()).run(spec);

        expect(Object.fromEntries((await deliverableOf()).sections)).toEqual(
          pushedSections,
        );
        expect(result.message).toContain("byro-repo #2 waits on you");
      });
    });
  });
});

// An earlier ticket's agent Section holds the hit; this ticket drafts The crossing.
const earlierAgentDraft =
  "## The harbour\n<!-- agent -->\n\nThe gulls slipped out at dawn.\n\n## The crossing\n<!-- agent -->\n\nThe ferry left late.\n";

// A red-checks step that commits nothing, so the checks stay red.
const stillRed: StepScript = async () =>
  resultOf({ summary: "Found no rewording that keeps the fact." });

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

// The harness's one overlap hit, dismissed, so a review with no findings goes straight on to land.
const slippedOutDismissed: DismissedOverlap = {
  hit: '"the ferry slipped out"',
  reason: "A fixed phrase for the event.",
};

// A piece review with no findings that spawned no reviewer, reviewing in the drafter's own session.
function pieceReviewedInline(): StepResult {
  return {
    ...resultOf({ findings: [], dismissedOverlaps: [slippedOutDismissed] }),
    sessionId: "review-session",
  };
}

function passagesPath(): string {
  return join(workspacePath(), ".runner", "passages", "byro-repo-1");
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

function researchScratchPath(): string {
  return join(workspacePath(), ".runner", "research", "byro-repo-1");
}

// A Doc of level-1 headings with no text of their own, each over its level-2 Sections of one paragraph.
function headedDocOf(
  parts: Record<string, Record<string, string>>,
): GoogleDocument {
  return documentOf(
    Object.entries(parts).flatMap(([h1, sections]) => [
      paragraphOf(h1, "HEADING_1"),
      ...h2ContentOf(sections),
    ]),
  );
}

// The headingId the fake Doc gives a heading: `h.` and its text hyphenated, as an author mark's ID holds no space.
function headingIdOf(text: string): string {
  return `h.${text.replaceAll(" ", "-")}`;
}

// The Doc with a headingId on each heading, as Docs gives one to every heading it holds.
function withHeadingIds(document: GoogleDocument): GoogleDocument {
  for (const { paragraph } of document.body?.content ?? []) {
    const style = paragraph?.paragraphStyle;
    const text = paragraph?.elements[0]?.textRun?.content.trim();
    if (
      text !== undefined &&
      style !== undefined &&
      style.namedStyleType !== "NORMAL_TEXT"
    ) {
      style.headingId = headingIdOf(text);
    }
  }
  return document;
}

// Two Parts, each with an Intro, so an H2's text alone names no one Section.
const twoPartSections = {
  "Part one": { Intro: "The quay was quiet." },
  "Part two": { Intro: "The ferry was late." },
};

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
    expect(ticketState()["byro-repo #1"]?.researchRecord).toEqual(record);
  });

  it("inlines /research-piece's and /review-research's bodies, never pointing at either by path", async () => {
    addPieceSpec([1]);
    const agentStep = FakeAgentStep.init(
      researched(readyRecordOf(scratchFolder())),
    );

    await specRun(agentStep).run(spec);

    const prompt = agentStep.requests[0]?.prompt ?? "";
    expect(prompt).toContain(
      '<skill name="research-piece">\nResearch a Piece\'s sources. Read [the pages](docs/pdf-pages.md).\n</skill>',
    );
    expect(prompt).toContain(
      '<skill name="review-research">\nVerify each claim against its source.\n</skill>',
    );
    expect(prompt).not.toContain(".claude/skills/");
    expect(prompt).not.toContain("## The first try");
  });

  it("names a scratch folder in the workspace, created before launch and gitignored", async () => {
    addPieceSpec([1]);
    const seen: { isThere?: boolean } = {};
    const agentStep = FakeAgentStep.init(async () => {
      seen.isThere = existsSync(researchScratchPath());
      return resultOf({ record: readyRecordOf(scratchFolder()) });
    });

    await specRun(agentStep).run(spec);

    expect(agentStep.requests[0]?.prompt).toContain(
      `Your scratch folder is \`${researchScratchPath()}\``,
    );
    expect(seen.isThere).toBe(true);
  });

  it("checks the quotes, posts the comment, writes the outcome row and closes the ticket", async () => {
    addPieceSpec([1]);
    const record = readyRecordOf(scratchFolder());

    const result = await specRun(FakeAgentStep.init(researched(record))).run(
      spec,
    );

    expect(result.landed).toEqual([refOf(1)]);
    expect(commentsOn(1, "The ferry ran.")).toHaveLength(1);
    expect(existsSync(outcomeRowPath(1))).toBe(true);
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
    expect(agentStep.requests[1]?.prompt).not.toContain("## The first try");
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
    expect(agentStep.requests[1]?.prompt).not.toContain("## The first try");
    expect(commentsOn(1, "## Handoff")[0]).toContain(
      "Read the lighthouse logbook; the ferry timetable is left.",
    );
    expect(ticketState()["byro-repo #1"]?.researchRecord).toEqual(record);
  });
});

describe("a research step retried by a Failure Halt's `retry`", () => {
  const broken = { status: "ready", blockers: [] };

  // A first try that leaves a comment and a source's text in its scratch folder, then returns a record breaking its schema.
  const leavesWork: StepScript = async () => {
    mkdirSync(join(researchScratchPath(), "texts"), { recursive: true });
    writeFileSync(
      join(researchScratchPath(), "comment.md"),
      "1. The ferry ran.\n",
    );
    writeFileSync(
      join(researchScratchPath(), "texts", "logbook.txt"),
      "The ferry ran.\n",
    );
    return resultOf({ record: broken });
  };

  async function retriedPromptAfter(firstTry: StepScript): Promise<string> {
    await specRun(FakeAgentStep.init(firstTry)).run(spec);
    github.reply(213, "H1: retry");
    const agentStep = FakeAgentStep.init(
      researched(readyRecordOf(scratchFolder())),
    );
    await specRun(agentStep).run(spec);
    return agentStep.requests[0]?.prompt ?? "";
  }

  it("names the first try's scratch folder, each file it left there and its comment", async () => {
    addPieceSpec([1]);

    const prompt = await retriedPromptAfter(leavesWork);

    expect(prompt).toContain("## The first try");
    expect(prompt).toContain(`\`${researchScratchPath()}\``);
    expect(prompt).toContain("- `comment.md`\n- `texts/logbook.txt`");
    expect(prompt).toContain(
      `Its comment is \`${join(researchScratchPath(), "comment.md")}\``,
    );
  });

  it("says the first try left no comment when it wrote none", async () => {
    addPieceSpec([1]);

    const prompt = await retriedPromptAfter(researched(broken));

    expect(prompt).toContain("## The first try");
    expect(prompt).toContain("It left no files there.");
    expect(prompt).toContain("It left no comment.");
  });

  it("names the first try in the retry's prompt only, not a later fresh step's", async () => {
    addPieceSpec([1]);
    await specRun(FakeAgentStep.init(leavesWork)).run(spec);
    github.reply(213, "H1: retry");
    const agentStep = FakeAgentStep.init(
      researched({
        status: "handoff",
        blockers: [],
        handoff: {
          conclusion: "Read the lighthouse logbook.",
          sourcesDone: ["lighthouse logbook"],
          sourcesLeft: [],
        },
      }),
      researched(readyRecordOf(scratchFolder())),
    );

    await specRun(agentStep).run(spec);

    expect(agentStep.requests[0]?.prompt).toContain("## The first try");
    expect(agentStep.requests[1]?.prompt).not.toContain("## The first try");
  });

  it("leaves a rerun after a blocker Halt's answer as a first try", async () => {
    addPieceSpec([1]);
    const blockedRecord: ResearchRecord = {
      status: "blocked",
      blockers: [
        {
          kind: "spec-ambiguity",
          detail: "The Facts field names two tellings of the walk.",
          recommendation: "Keep the earlier telling.",
        },
      ],
    };

    const prompt = await retriedPromptAfter(researched(blockedRecord));

    expect(prompt).not.toContain("## The first try");
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
    expect(halt).toContain(
      "2. `another source F<n>`, naming the source: tell the Supervisor in its session, not in a reply here.",
    );
    expect(halt).toContain(
      "posts it as an addendum on the Research ticket, then answers this Halt",
    );
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

  it("applies an approved Outline edit to the spec body word for word, then drafting goes on", async () => {
    await answerResearchHalt("H1: drop F1, approve E1");

    const result = await specRun(FakeAgentStep.init()).run(spec);

    expect(github.issues.get(spec.number)?.body).toBe(editedSpecBody);
    expect(result.message).toContain(draftingGoesOn);
  });

  it("applies only the edit an answer approves, leaving the other's text as it was", async () => {
    addResearchedSpec();
    const twoLines = outlinedSpecBody.replace(
      "\n\n## Facts",
      "\n- **The harbour**: the gulls rose at dawn.\n\n## Facts",
    );
    github.edit(spec.number, { body: twoLines });
    const ready = readyRecordOf(scratchFolder());
    const record: ReadyResearchRecord = {
      ...ready,
      outlineEdits: [
        ...ready.outlineEdits,
        {
          section: "The harbour",
          oldText: "the gulls rose at dawn.",
          newText: "the gulls slept through the dawn.",
          reason: "The logbook calls the dawn still.",
        },
      ],
    };
    await specRun(FakeAgentStep.init(researched(record))).run(spec);
    github.reply(spec.number, "H1: approve E2");

    await specRun(FakeAgentStep.init()).run(spec);

    expect(github.issues.get(spec.number)?.body).toBe(
      twoLines.replace(
        "the gulls rose at dawn.",
        "the gulls slept through the dawn.",
      ),
    );
  });

  it("leaves the spec body alone on a `stop spec` answer that names an edit", async () => {
    await answerResearchHalt("H1: stop spec, approve E1");

    await specRun(FakeAgentStep.init()).run(spec);

    expect(github.issues.get(spec.number)?.body).toBe(outlinedSpecBody);
  });

  it("applies nothing twice when a killed run reads the answer again", async () => {
    await answerResearchHalt("H1: approve E1");
    await specRun(FakeAgentStep.init()).run(spec);
    const saved = JSON.parse(readFileSync(runStatePath(), "utf8")) as {
      halts: Halt[];
    };
    saved.halts.forEach((halt) => {
      halt.isDelivered = false;
    });
    writeFileSync(runStatePath(), JSON.stringify(saved));

    const result = await specRun(FakeAgentStep.init()).run(spec);

    expect(github.issues.get(spec.number)?.body).toBe(editedSpecBody);
    expect(haltComments()).toHaveLength(1);
    expect(result.message).toContain(draftingGoesOn);
  });

  it("raises a fresh Halt on an approved edit it can't apply, holding drafting until `continue`", async () => {
    await answerResearchHalt("H1: approve E1");
    const handEdited = outlinedSpecBody.replace(
      outlineTexts.old,
      "the ferry waited out the storm.",
    );
    github.edit(spec.number, { body: handEdited });

    const halted = await specRun(FakeAgentStep.init()).run(spec);

    expect(github.issues.get(spec.number)?.body).toBe(handEdited);
    expect(haltComments()).toHaveLength(2);
    const fresh = haltComments()[1];
    expect(fresh).toContain("**Halt H2**");
    expect(fresh).toContain(
      `**E1** The crossing: replace "${outlineTexts.old}"`,
    );
    expect(fresh).toContain("`continue`");
    expect(fresh).toContain("Blocks: byro-repo#2 and their downstream.");
    expect(halted.message).toContain("byro-repo #2 waits on Halt H2");
    github.reply(spec.number, "H2: continue");

    const result = await specRun(FakeAgentStep.init()).run(spec);

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

  it("lists an unwanted fact in the research ticket's review list as a collapsed audit with no undecided item, and the run goes on", async () => {
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

    const [list, ...others] = commentsOn(spec.number, researchListMark);
    expect(others).toEqual([]);
    expect(list).toContain(
      "<details>\n<summary>Unverified facts the Facts field didn't name: 1</summary>\n\n- The ferry was painted blue. (No source names its colour.)\n\n</details>",
    );
    expect(list).not.toContain("- [ ]");
    expect(result.message).toContain(draftingGoesOn);
  });

  it("leaves a wanted fact out of the research ticket's review list, posting none when it holds no unwanted fact", async () => {
    addResearchedSpec();

    await specRun(
      FakeAgentStep.init(researched(readyRecordOf(scratchFolder()))),
    ).run(spec);

    expect(commentsOn(spec.number, researchListMark)).toEqual([]);
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
    const record = readyRecordOf(scratchFolder());
    // A file where the outcome folder goes stops the wrap-up at its row, now that a research ticket pushes nothing.
    const agentStep = FakeAgentStep.init(async () => {
      writeFileSync(outcomeFolder(), "");
      return resultOf({ record });
    });

    const stopped = await specRun(agentStep).run(spec);

    expect(stopped.kind).toBe("stopped");
    expect(haltComments()).toEqual([]);
    rmSync(outcomeFolder());

    const result = await specRun(FakeAgentStep.init()).run(spec);

    expect(result.landed).toEqual([refOf(1)]);
    expect(haltComments()).toHaveLength(1);
    expect(result.message).toContain("byro-repo #2 waits on Halt H1");
    expect(ticketFacts().halt).toBeUndefined();
  });
});

const outlineTexts = {
  old: "the storm came, then the ferry ran.",
  proposed: "the ferry ran before the storm came.",
} as const;
const outlinedSpecBody = `## Deliverable\n\nThe crossing.\n\n## Outline\n\n- **The crossing**: ${outlineTexts.old}\n\n## Facts\n\n- The ferry carried forty people.\n`;
const editedSpecBody = `## Deliverable\n\nThe crossing.\n\n## Outline\n\n- **The crossing**: ${outlineTexts.proposed}\n\n## Facts\n\n- The ferry carried forty people.\n`;

// Lands the research ticket, raising H1, then answers it.
async function answerResearchHalt(answer: string): Promise<void> {
  addResearchedSpec();
  await specRun(
    FakeAgentStep.init(researched(readyRecordOf(scratchFolder()))),
  ).run(spec);
  github.reply(spec.number, answer);
}

const researchListMark = "<!-- review-list ticket=#1 -->";

// The drafting ticket isn't ready-for-agent, so it waits on the developer once no Halt holds it.
const draftingGoesOn = "byro-repo #2 waits on you";

// Research ticket #1 blocks drafting ticket #2, which isn't ready-for-agent, so the run launches only the research.
function addResearchedSpec(): void {
  addPieceSpec([1, 2]);
  github.edit(2, { labels: [] });
  github.blockers.set(2, [1]);
  github.edit(spec.number, { body: outlinedSpecBody });
}

const logbookId = "1LighthouseLogbook000000000000000";
const timetableId = "1FerryTimetable_2-0000000000000000";
const quayPhotoId = "1QuayAtDawnPhoto00000000000000000";

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

const pieceResearch = refOf(301);
const codeTicket = refOf(302);

function addPieceResearchTicket(): void {
  addIssue(pieceResearch.number, {
    labels: ["ready-for-agent", "piece", "research"],
  });
}

describe("run on a Standalone ticket", () => {
  it("runs a piece-labelled research ticket's research step, by its own label", async () => {
    addPieceResearchTicket();
    const agentStep = FakeAgentStep.init(
      researched(readyRecordOf(scratchFolder())),
    );

    await specRun(agentStep, { members: [pieceResearch] }).run(pieceResearch);

    expect(agentStep.requests).toHaveLength(1);
    expect(agentStep.requests[0]?.prompt).toContain(
      '<skill name="research-piece">',
    );
  });

  it("runs each member of a Batch by its own label, a piece ticket and a code ticket alike", async () => {
    addPieceResearchTicket();
    addIssue(codeTicket.number, { labels: ["ready-for-agent", "research"] });
    const members = [pieceResearch, codeTicket];
    const agentStep = FakeAgentStep.init(
      researched(readyRecordOf(scratchFolder())),
      implemented("code.ts"),
      reviewed(),
    );

    const result = await specRun(agentStep, { members }).run(
      pieceResearch,
      codeTicket,
    );

    const [research, implement] = agentStep.requests;
    expect(research?.prompt).toContain('<skill name="research-piece">');
    expect(implement?.prompt).not.toContain("research-piece");
    expect(result.landed).toContainEqual(codeTicket);
  });
});
