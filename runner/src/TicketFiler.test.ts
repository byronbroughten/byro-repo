import { describe, expect, it } from "vitest";

import { FakeGitHub } from "./FakeGitHub.ts";
import type { DraftFile } from "./ticketDrafts.ts";
import { TicketFiler } from "./TicketFiler.ts";

const repo = "byro-repo";
const parent = 747;

const readySections = `## Where

The filer.

## Model fit

Sonnet medium
A small change. ~40K`;

function draftOf(
  fileName: string,
  {
    title = "A ticket",
    kind = "agent",
    labels = "",
    blockers = "",
    sections = readySections,
  } = {},
): DraftFile {
  const text = `---
title: ${title}
kind: ${kind}
labels: ${labels}
blockers: ${blockers}
---

## What to build

${title}, built.

${sections}
`;
  return { fileName, text };
}

function githubWithParent(): FakeGitHub {
  const github = FakeGitHub.init();
  github.issues.set(parent, {
    issue: { repo, number: parent },
    title: "The spec",
    body: "",
    isOpen: true,
    labels: [],
    url: "",
    author: "byronbroughten",
    bodyEditors: [],
  });
  return github;
}

describe("TicketFiler", () => {
  it("files each draft with its title, triage label and other labels, under the parent in draft order", async () => {
    const github = githubWithParent();
    const report = await TicketFiler.init(github).file({
      repo,
      parent,
      files: [
        draftOf("2-reader.md", { title: "Read issues", kind: "interactive" }),
        draftOf("1-writer.md", {
          title: "Write issues",
          labels: "runner, docs",
        }),
      ],
    });

    expect(report.exitCode).toBe(0);
    expect(github.issues.get(748)).toMatchObject({
      title: "Write issues",
      labels: ["ready-for-agent", "runner", "docs"],
      body: `## What to build\n\nWrite issues, built.\n\n${readySections}`,
    });
    expect(github.issues.get(749)).toMatchObject({
      title: "Read issues",
      labels: ["ready-for-interactive"],
    });
    expect(github.subIssues.get(parent)).toEqual([748, 749]);
    expect(report.text).toBe("1-writer.md: #748\n2-reader.md: #749");
  });

  it("files each blocker before the drafts that name it, and sets the blocked-by edges", async () => {
    const github = githubWithParent();
    const report = await TicketFiler.init(github).file({
      repo,
      parent,
      files: [
        draftOf("1-top.md", { title: "Top", blockers: "3, 2" }),
        draftOf("2-middle.md", { title: "Middle", blockers: "3" }),
        draftOf("3-base.md", { title: "Base" }),
      ],
    });

    expect(report.exitCode).toBe(0);
    const numberOf = (title: string) =>
      [...github.issues.values()].find((issue) => issue.title === title)?.issue
        .number;
    expect([numberOf("Base"), numberOf("Middle"), numberOf("Top")]).toEqual([
      748, 749, 750,
    ]);
    expect(github.blockers.get(750)).toEqual([748, 749]);
    expect(github.blockers.get(749)).toEqual([748]);
    expect(github.blockers.get(748)).toBeUndefined();
    expect(github.subIssues.get(parent)).toEqual([750, 749, 748]);
    expect(report.text).toBe(
      "1-top.md: #750\n2-middle.md: #749\n3-base.md: #748",
    );
  });

  it("files a standalone ticket with no parent link when no parent is given", async () => {
    const github = FakeGitHub.init();
    const report = await TicketFiler.init(github).file({
      repo,
      files: [draftOf("1-alone.md", { title: "Alone", kind: "human" })],
    });

    expect(report.exitCode).toBe(0);
    expect(github.issues.get(1)).toMatchObject({
      title: "Alone",
      labels: ["ready-for-human"],
    });
    expect(github.subIssues.size).toBe(0);
  });

  it("files a human draft with no Where or Model fit section", async () => {
    const github = FakeGitHub.init();
    const report = await TicketFiler.init(github).file({
      repo,
      files: [draftOf("1-alone.md", { kind: "human", sections: "" })],
    });

    expect(report.exitCode).toBe(0);
    expect(github.issues.get(1)?.labels).toEqual(["ready-for-human"]);
  });

  it("exits nonzero naming the draft whose ticket reads back with a different title", async () => {
    const github = githubWithParent();
    github.afterCreates.push(
      () => {},
      (number) => {
        github.edit(number, { title: "Renamed" });
      },
    );
    const report = await TicketFiler.init(github).file({
      repo,
      parent,
      files: [
        draftOf("1-first.md", { title: "First" }),
        draftOf("2-second.md", { title: "Second" }),
      ],
    });

    expect(report.exitCode).toBe(1);
    expect(report.text).toContain("2-second.md (#749)");
    expect(report.text).toContain('"Renamed"');
    expect(report.text).not.toContain("1-first.md (#748)");
  });

  it("exits nonzero naming each draft whose labels or parent read back wrong", async () => {
    const github = githubWithParent();
    github.afterCreates.push(
      (number) => {
        github.edit(number, { labels: ["ready-for-agent"] });
      },
      (number) => {
        github.parents.set(number, {
          issue: { repo, number: 700 },
          labels: [],
          subIssues: { total: 1, completed: 0 },
        });
      },
    );
    const report = await TicketFiler.init(github).file({
      repo,
      parent,
      files: [
        draftOf("1-first.md", { labels: "runner" }),
        draftOf("2-second.md"),
      ],
    });

    expect(report.exitCode).toBe(1);
    expect(report.text).toContain("1-first.md (#748): labels");
    expect(report.text).toContain("2-second.md (#749): parent");
  });

  it("exits nonzero naming the draft whose blocked-by edges read back wrong", async () => {
    const github = githubWithParent();
    github.afterCreates.push(
      () => {},
      (number) => {
        github.edit(number - 1, { isOpen: false });
      },
    );
    const report = await TicketFiler.init(github).file({
      repo,
      parent,
      files: [draftOf("1-first.md"), draftOf("2-second.md", { blockers: "1" })],
    });

    expect(report.exitCode).toBe(1);
    expect(report.text).toContain("2-second.md (#749): blocked by");
  });

  describe("on a gh failure partway, names the draft and lists the tickets already filed", () => {
    const files = [draftOf("1-first.md"), draftOf("2-second.md")];

    it("while creating a ticket", async () => {
      const github = githubWithParent();
      github.afterCreates.push(() => {
        github.failuresLeft = 1;
      });

      await expect(
        TicketFiler.init(github).file({ repo, parent, files }),
      ).rejects.toThrow(
        "2-second.md: filing stopped creating its ticket: gh: connection reset Filed so far, to fix by hand: 1-first.md: #748.",
      );
    });

    it("while linking a ticket", async () => {
      const github = githubWithParent();
      github.afterCreates.push(
        () => {},
        () => {
          github.failuresLeft = 1;
        },
      );

      await expect(
        TicketFiler.init(github).file({ repo, parent, files }),
      ).rejects.toThrow(
        "1-first.md: filing stopped linking its ticket: gh: connection reset Filed so far, to fix by hand: 1-first.md: #748, 2-second.md: #749.",
      );
    });
  });

  describe("refuses before anything is filed", () => {
    async function refusalOf(files: DraftFile[]): Promise<string> {
      const github = githubWithParent();
      const refusal = await TicketFiler.init(github)
        .file({ repo, parent, files })
        .then(
          () => undefined,
          (error: unknown) => error,
        );
      expect(refusal).toBeInstanceOf(Error);
      expect(github.issues.size).toBe(1);
      return (refusal as Error).message;
    }

    it("a blocker cycle, naming its drafts", async () => {
      const message = await refusalOf([
        draftOf("1-a.md", { blockers: "2" }),
        draftOf("2-b.md", { blockers: "1" }),
        draftOf("3-c.md"),
      ]);
      expect(message).toContain("cycle");
      expect(message).toContain("1-a.md");
      expect(message).toContain("2-b.md");
      expect(message).not.toContain("3-c.md");
    });

    it("a blocker number with no draft", async () => {
      const message = await refusalOf([draftOf("1-a.md", { blockers: "4" })]);
      expect(message).toContain("1-a.md");
      expect(message).toContain("4");
    });

    it("a triage label among the other labels", async () => {
      const message = await refusalOf([
        draftOf("1-a.md"),
        draftOf("2-b.md", { labels: "ready-for-human" }),
      ]);
      expect(message).toContain("2-b.md");
      expect(message).toContain("ready-for-human");
    });

    it("an unknown kind", async () => {
      const message = await refusalOf([draftOf("1-a.md", { kind: "afk" })]);
      expect(message).toContain("1-a.md");
      expect(message).toContain("agent, interactive, human");
    });

    it("a file name with no draft number, or two drafts of one number", async () => {
      expect(await refusalOf([draftOf("notes.md")])).toContain("notes.md");
      expect(
        await refusalOf([draftOf("1-a.md"), draftOf("01-b.md")]),
      ).toContain("01-b.md");
    });

    it("a draft with no front matter, no title or an unknown key", async () => {
      expect(
        await refusalOf([{ fileName: "1-a.md", text: "# Title\n\nBody" }]),
      ).toContain("front matter");
      expect(
        await refusalOf([
          { fileName: "1-a.md", text: "---\nkind: agent\n---\nBody" },
        ]),
      ).toContain("title");
      expect(
        await refusalOf([
          {
            fileName: "1-a.md",
            text: "---\ntitle: T\nkind: agent\nparent: 3\n---\nBody",
          },
        ]),
      ).toContain("parent");
    });

    it("every agent or interactive draft missing Where or a sound Model fit, naming each draft and section in one pass", async () => {
      const message = await refusalOf([
        draftOf("1-no-where.md", {
          sections: "## Model fit\n\nOpus low\nSmall. ~20K",
        }),
        draftOf("2-no-fit.md", {
          kind: "interactive",
          sections: "## Where\n\nHere.",
        }),
        draftOf("3-fit-not-last.md", {
          sections:
            "## Model fit\n\nOpus low\nSmall. ~20K\n\n## Where\n\nHere.",
        }),
        draftOf("4-bad-pair.md", {
          sections: "## Where\n\nHere.\n\n## Model fit\n\nOpus max\nBig. ~20K",
        }),
        draftOf("5-no-estimate.md", {
          sections: "## Where\n\nHere.\n\n## Model fit\n\nOpus low\nSmall.",
        }),
        draftOf("6-sound.md"),
      ]);
      const lines = message.split("\n");
      expect(lines).toContainEqual(
        expect.stringMatching(/1-no-where\.md.*## Where/),
      );
      expect(lines).toContainEqual(
        expect.stringMatching(/2-no-fit\.md.*## Model fit/),
      );
      expect(lines).toContainEqual(
        expect.stringMatching(/3-fit-not-last\.md.*## Model fit.*last/),
      );
      expect(lines).toContainEqual(
        expect.stringMatching(/4-bad-pair\.md.*pair/),
      );
      expect(lines).toContainEqual(
        expect.stringMatching(/5-no-estimate\.md.*~NK/),
      );
      expect(message).not.toContain("6-sound.md");
    });

    it("a draft with a malformed Targets line, naming the line, beside one whose Targets pass", async () => {
      const message = await refusalOf([
        draftOf("1-bare-target.md", {
          sections: `## Targets\n\ndev spreadsheet\n\n${readySections}`,
        }),
        draftOf("2-sound-targets.md", {
          sections: `## Targets\n\n- dev spreadsheet\n\n${readySections}`,
        }),
      ]);
      expect(message).toMatch(
        /1-bare-target\.md.*## Targets.*`dev spreadsheet`/,
      );
      expect(message).not.toContain("2-sound-targets.md");
    });

    it("no drafts at all", async () => {
      expect(await refusalOf([])).toContain("no drafts");
    });
  });
});
