import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { CloseOutBrief } from "./CloseOutBrief.ts";
import { FakeGitHub } from "./FakeGitHub.ts";
import { runnerMark } from "./halts.ts";
import { gapCheckListOf, ticketReviewListOf } from "./reviewList.ts";

const developer = "byronbroughten";
const repo = "byro-repo";
const parent = 804;

let github: FakeGitHub;
let temp: string;

beforeEach(() => {
  github = FakeGitHub.init();
  temp = mkdtempSync(join(tmpdir(), "close-out-"));
  track(parent, { title: "Close a parent", body: "The spec's body." });
  track(810, { title: "First ticket", isOpen: false });
  track(811, { title: "Second ticket", isOpen: false });
  github.subIssues.set(parent, [810, 811]);
  github.reply(810, "Landed the first ticket.");
  github.reply(811, "Landed the second ticket.");
});

afterEach(() => {
  rmSync(temp, { recursive: true, force: true });
});

interface TrackedFields {
  title: string;
  body?: string;
  isOpen?: boolean;
  labels?: string[];
  author?: string;
}

function track(
  number: number,
  {
    title,
    body = "",
    isOpen = true,
    labels = [],
    author = developer,
  }: TrackedFields,
): void {
  github.issues.set(number, {
    issue: { repo, number },
    title,
    body,
    isOpen,
    labels,
    url: `https://github.com/o/${repo}/issues/${number}`,
    author,
    bodyEditors: [],
  });
}

function closeOut(): CloseOutBrief {
  return CloseOutBrief.init({
    github,
    developer,
    githubOwner: developer,
    allowedRepos: [repo, "sheets-framework"],
  });
}

async function briefOf(...flags: string[]): Promise<string> {
  return closeOut().brief([repo, String(parent), ...flags]);
}

function commentFileOf(text: string): string {
  const path = join(temp, "closing.md");
  writeFileSync(path, text);
  return path;
}

function undecidedListOf(): string {
  const list = ticketReviewListOf({
    ticket: { repo, number: 810 },
    title: "First ticket",
    records: [
      {
        finding: 1,
        axis: "spec",
        where: "one.ts:1",
        claim: "Line 1 is wrong.",
        evidence: "Checked it.",
        verdict: "propose",
        reason: "decision",
        recommendation: "Pick the first.",
      },
    ],
  });
  if (list === undefined) throw new Error("The record built no list.");
  return `${runnerMark}\n${list}`;
}

describe("the Close-out brief", () => {
  it("prints the parent's body and each sub-issue's title, state and closing comment, saying what it holds", async () => {
    const brief = await briefOf();

    expect(brief).toMatch(/^issue:close-parent brief of byro-repo #804: /);
    expect(brief).toContain(
      "## Parent body (Trusted text)\n\nThe spec's body.",
    );
    expect(brief).toContain(
      "### #810 First ticket: closed\n\nClosing comment (Trusted text):\n\nLanded the first ticket.",
    );
    expect(brief).toContain(
      "### #811 Second ticket: closed\n\nClosing comment (Trusted text):\n\nLanded the second ticket.",
    );
  });

  it("takes the developer's last comment as the closing comment", async () => {
    github.reply(810, "Its real closing comment.");

    const brief = await briefOf();

    expect(brief).toContain(
      "Closing comment (Trusted text):\n\nIts real closing comment.",
    );
  });

  it("says no gap check is on the parent when none was posted", async () => {
    expect(await briefOf()).toContain(
      "## Gap check: no run's gap check (`ticket=gap-check`) is on #804, so the Close-out runs its own",
    );
  });

  it("says a run's gap check is on the parent when its list was posted", async () => {
    github.reply(
      parent,
      `${runnerMark}\n${gapCheckListOf("Close a parent", { gaps: [] })}`,
    );

    expect(await briefOf()).toContain(
      "## Gap check: a run's gap check (`ticket=gap-check`) is on #804, so the Close-out runs none",
    );
  });

  it("names each sub-issue carrying the piece label", async () => {
    github.edit(811, { labels: ["piece"] });

    expect(await briefOf()).toContain(
      "## Piece ticket: #811 carries the `piece` label",
    );
  });

  it("says no sub-issue is a piece ticket when none carries the label", async () => {
    expect(await briefOf()).toContain(
      "## Piece ticket: none, no sub-issue carries the `piece` label",
    );
  });

  it("prints the parent check and each parent above that would become ready, each named", async () => {
    track(800, { title: "The spec's parent" });
    track(799, { title: "The top" });
    track(798, { title: "A sibling" });
    github.subIssues.set(800, [parent]);
    github.subIssues.set(799, [800, 798]);

    const brief = await briefOf();

    expect(brief).toContain(
      [
        "## Parent check, once #804 closes",
        "",
        "- #804's parent #800 has every sub-issue closed, so it is ready to close: `npm run issue:close-parent -- byro-repo 800`.",
        "- #800's parent #799 still has open sub-issues.",
      ].join("\n"),
    );
  });

  it("says the parent has no parent when none is above it", async () => {
    expect(await briefOf()).toContain("- #804 has no parent.");
  });
});

describe("the Close-out brief's refusals", () => {
  it("refuses a wayfinder map, naming the Arrive operation", async () => {
    github.edit(parent, { labels: ["wayfinder:map"] });

    const brief = await briefOf();

    expect(brief).toMatch(
      /^issue:close-parent brief of byro-repo #804: refused, byro-repo #804 is a wayfinder:map, which closes only by the issue tracker doc's Arrive operation/,
    );
    expect(brief).not.toContain("The spec's body.");
  });

  it("refuses undecided review-list items, naming /judge-findings", async () => {
    github.reply(parent, undecidedListOf());

    const brief = await briefOf();

    expect(brief).toMatch(
      /^issue:close-parent brief of byro-repo #804: refused/,
    );
    expect(brief).toContain("run `/judge-findings byro-repo 804` first.");
    expect(brief).not.toContain("The spec's body.");
  });

  it("refuses open sub-issues, naming each, then prints the chain that would become ready", async () => {
    github.edit(811, { isOpen: true });
    track(800, { title: "The spec's parent" });
    github.subIssues.set(800, [parent]);

    const brief = await briefOf();

    expect(brief).toMatch(
      /^issue:close-parent brief of byro-repo #804: refused/,
    );
    expect(brief).toContain("- Open sub-issues: #811; each closes first.");
    expect(brief).toContain(
      [
        "## Parent check, once #811 and #804 close",
        "",
        "- #804's parent #800 has every sub-issue closed, so it is ready to close: `npm run issue:close-parent -- byro-repo 800`.",
        "- #800 has no parent.",
      ].join("\n"),
    );
  });

  it("names an open Edit gate as the gate to close out first instead of refusing", async () => {
    github.edit(810, { labels: ["piece"] });
    github.edit(811, { isOpen: true, labels: ["ready-for-human"] });

    const brief = await briefOf();

    expect(brief).not.toContain("refused");
    expect(brief).toContain(
      "## Edit gate: #811 is open, the Edit gate to close out first: `/close-piece byro-repo 811`, before #804 closes",
    );
  });

  it("refuses an open ready-for-human sub-issue on a spec with no piece ticket", async () => {
    github.edit(811, { isOpen: true, labels: ["ready-for-human"] });

    expect(await briefOf()).toContain(
      "- Open sub-issues: #811; each closes first.",
    );
  });

  it("refuses a repo outside the repo map", async () => {
    const brief = await closeOut().brief(["someone-elses-repo", "804"]);

    expect(brief).toBe(
      'issue:close-parent brief: none, Repo "someone-elses-repo" is not one of byro-repo, sheets-framework',
    );
  });

  it("words a failed GitHub read as its own outcome", async () => {
    github.failuresLeft = 1;

    expect(await briefOf()).toBe(
      "issue:close-parent brief: none, reading byro-repo #804 from GitHub failed: gh: connection reset",
    );
  });
});

describe("the Close-out brief's Trust", () => {
  it("prints an Untrusted body only as the command that reads it", async () => {
    track(parent, {
      title: "Close a parent",
      body: "Someone else's body.",
      author: "someone-else",
    });

    const brief = await briefOf();

    expect(brief).not.toContain("Someone else's body.");
    expect(brief).toContain("`npm run issue:read -- byro-repo 804 --body`");
  });

  it("counts others' comments on a sub-issue with the command that reads them", async () => {
    github.reply(810, "Someone else's comment.", "someone-else");

    const brief = await briefOf();

    expect(brief).not.toContain("Someone else's comment.");
    expect(brief).toContain(
      "Comments by others: 1 (Untrusted text), not printed; `npm run issue:read -- byro-repo 810 --comments` reads them",
    );
  });
});

describe("the Close-out with --comment-file", () => {
  it("posts the file as the closing comment, closes the parent and prints its parent check", async () => {
    track(800, { title: "The spec's parent" });
    github.subIssues.set(800, [parent]);
    const path = commentFileOf("Every ticket landed.\n");

    const brief = await briefOf("--comment-file", path);

    expect(github.closed).toEqual([
      { issue: { repo, number: parent }, comment: "Every ticket landed." },
    ]);
    expect(brief).toBe(
      [
        `issue:close-parent closed byro-repo #804 with the comment in ${path}, then read its parent check.`,
        "",
        "#804's parent #800 has every sub-issue closed, so it is ready to close: `npm run issue:close-parent -- byro-repo 800`.",
      ].join("\n"),
    );
  });

  it("refuses an open Edit gate with nothing closed", async () => {
    github.edit(810, { labels: ["piece"] });
    github.edit(811, { isOpen: true, labels: ["ready-for-human"] });

    const brief = await briefOf("--comment-file", commentFileOf("Done."));

    expect(github.closed).toEqual([]);
    expect(brief).toBe(
      "issue:close-parent brief: none, the Edit gate byro-repo #811 is still open: close it out first with `/close-piece byro-repo 811`; nothing was posted or closed",
    );
  });

  it.each([
    [
      "open sub-issues",
      (): void => {
        github.edit(811, { isOpen: true });
      },
    ],
    [
      "undecided items",
      (): void => {
        github.reply(parent, undecidedListOf());
      },
    ],
    [
      "a map",
      (): void => {
        github.edit(parent, { labels: ["wayfinder:map"] });
      },
    ],
  ])("refuses %s with nothing closed", async (_, arrange) => {
    arrange();

    const brief = await briefOf("--comment-file", commentFileOf("Done."));

    expect(github.closed).toEqual([]);
    expect(brief).toContain("refused");
    expect(brief).toMatch(
      /With --comment-file, nothing was posted or closed\.$/,
    );
  });

  it("refuses an empty comment file with nothing closed", async () => {
    const path = commentFileOf("\n");

    const brief = await briefOf("--comment-file", path);

    expect(github.closed).toEqual([]);
    expect(brief).toBe(
      `issue:close-parent brief: none, ${path} is empty; nothing was posted or closed`,
    );
  });
});
