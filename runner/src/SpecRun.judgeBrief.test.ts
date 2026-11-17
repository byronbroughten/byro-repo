import { describe, expect, it } from "vitest";

import { FakeAgentStep } from "./FakeAgentStep.ts";
import { commentUrlOf } from "./FakeGitHub.ts";
import {
  addIssue,
  github,
  refOf,
  specRun,
  useSpecRunHarness,
} from "./specRunHarness.ts";

useSpecRunHarness();

function listBodyOf(ticket: number, items: string[]): string {
  return [
    "<!-- spec-runner -->",
    `<!-- review-list ticket=#${ticket} -->`,
    "",
    `**Review list** · byro-repo #${ticket}, "Ticket ${ticket}"`,
    "",
    ...items,
  ].join("\n");
}

const gapListBody = [
  "<!-- spec-runner -->",
  "<!-- review-list ticket=gap-check -->",
  "",
  '**Review list** · gap check, "Ticket 20"',
  "",
  "- [ ] **Rgap-check.1** · Gap · story 5",
  "  Evidence: eg",
  "  Recommendation: rg",
].join("\n");

function haltBodyOf(id: string, ticket: number, blocks: string): string {
  return [
    `<!-- spec-runner -->\n**Halt ${id}** · Halt 1 of 1 · byro-repo #${ticket}, "Ticket ${ticket}" · verdict Halt`,
    "Finding 2: the secret question body.",
    `Blocks: ${blocks}.`,
    "Options:\n1. Pick one\n2. `stop spec`",
    `Answer with a reply that opens with \`${id}:\`, then an option or your own words.`,
  ].join("\n\n");
}

// Each sub-issue maps to its labels; the first is closed, the rest open.
function addSpecOf(number: number, subIssues: Record<number, string[]>): void {
  addIssue(number, { labels: ["code"], body: "The secret spec body." });
  github.subIssues.set(number, Object.keys(subIssues).map(Number));
  for (const [index, [sub, labels]] of Object.entries(subIssues).entries()) {
    addIssue(Number(sub), { labels });
    if (index === 0) github.edit(Number(sub), { isOpen: false });
  }
}

// The URL of the comment the fake holds at a 1-based place among every issue's comments.
function urlOf(spec: number, place: number): string {
  return commentUrlOf(refOf(spec), place);
}

function judgeBrief(...specs: (number | "all")[]): Promise<string> {
  return specRun(FakeAgentStep.init()).judgeBrief("byro-repo", specs);
}

describe("judgeBrief", () => {
  it("prints a spec's header, piece flag, sub-issues, items in judging order and counts, never a Halt's or the spec's body", async () => {
    addIssue(4, { labels: [] });
    addSpecOf(20, { 21: ["code"], 22: ["code"] });
    github.subIssues.set(4, [20]);
    github.reply(
      20,
      listBodyOf(21, [
        "- [ ] **R21.1** · Propose `decision` · a",
        "  Evidence: e1",
        "  Recommendation: r1",
        "- [x] **R21.2** · Propose `decision` · b",
        "  Decided: accepted",
      ]),
    );
    github.reply(20, gapListBody);
    github.reply(
      20,
      listBodyOf(22, [
        "- [x] **R22.1** · Propose `decision` · c",
        "  Evidence: e2",
        "  Recommendation: r2",
      ]),
    );
    github.reply(20, haltBodyOf("H1", 22, "only this ticket"));
    github.reply(20, "Someone's secret reply.", "someone");

    const brief = await judgeBrief(20);

    expect(brief).toBe(
      [
        "# byro-repo #20 Ticket 20",
        "State: open",
        "Labels: code",
        "Parent: #4",
        "Piece ticket: none, no sub-issue carries the `piece` label",
        "",
        "## Sub-issues",
        "",
        "- #21 Ticket 21: closed",
        "- #22 Ticket 22: open",
        "",
        "## Items to judge, in judging order",
        "",
        "### R22.1 · hand-ticked · Halt-adjacent: H1",
        `Comment: comment-3 ${urlOf(20, 3)}`,
        "",
        "- [x] **R22.1** · Propose `decision` · c",
        "  Evidence: e2",
        "  Recommendation: r2",
        "",
        "### R21.1 · undecided",
        `Comment: comment-1 ${urlOf(20, 1)}`,
        "",
        "- [ ] **R21.1** · Propose `decision` · a",
        "  Evidence: e1",
        "  Recommendation: r1",
        "",
        "### Rgap-check.1 · undecided",
        `Comment: comment-2 ${urlOf(20, 2)}`,
        "",
        "- [ ] **Rgap-check.1** · Gap · story 5",
        "  Evidence: eg",
        "  Recommendation: rg",
        "",
        "## Left out",
        "",
        "Decided items: 1, not printed; `npm run issue:read -- byro-repo 20 --comments` reads them",
        "Comments by others: 1 (Untrusted text), not printed; `npm run issue:read -- byro-repo 20 --comments` reads them",
        "",
        "It holds everything /judge-findings' step 1 needs for byro-repo #20; don't read the spec, its sub-issues or its comments again.",
      ].join("\n"),
    );
    expect(brief).not.toContain("secret");
  });

  it("finds a piece ticket by its label on a mixed spec", async () => {
    addSpecOf(20, { 21: ["code"], 22: ["piece"], 23: ["code", "piece"] });

    expect(await judgeBrief(20)).toContain(
      "Piece ticket: #22, #23 carry the `piece` label",
    );
  });

  it("says so when nothing is left to judge", async () => {
    addSpecOf(20, {});

    const brief = await judgeBrief(20);

    expect(brief).toContain("Parent: none");
    expect(brief).toContain("## Sub-issues\n\nNone.");
    expect(brief).toContain("## Items to judge, in judging order\n\nNone.");
    expect(brief).toContain("Decided items: 0");
    expect(brief).toContain("Comments by others: 0");
  });

  it("prints each named spec in the order given, wording a failed read as its own", async () => {
    addSpecOf(30, {});
    addSpecOf(20, {});

    const brief = await judgeBrief(30, 99, 20);

    const headings = brief.split("\n").filter((line) => line.startsWith("# "));
    expect(headings).toEqual([
      "# byro-repo #30 Ticket 30",
      "# byro-repo #99: no brief, its read failed: No issue #99",
      "# byro-repo #20 Ticket 20",
    ]);
  });

  it("names an untrusted title's reader rather than printing it", async () => {
    addSpecOf(20, {});
    github.edit(20, { title: "A secret title", author: "someone" });

    const brief = await judgeBrief(20);

    expect(brief).toContain(
      "# byro-repo #20 (title not printed, Untrusted text: written by someone; `npm run issue:read -- byro-repo 20 --body` reads it)",
    );
    expect(brief).not.toContain("secret");
  });

  it("names the reader of a title someone else renamed, on the spec and its sub-issues", async () => {
    addSpecOf(20, { 21: [] });
    github.edit(20, { title: "A secret title" });
    github.titleRenamers.set(20, "someone");
    github.titleRenamers.set(21, "someone");

    const brief = await judgeBrief(20);

    expect(brief).toContain(
      "# byro-repo #20 (title not printed, Untrusted text: renamed by someone; `npm run issue:read -- byro-repo 20 --body` reads it)",
    );
    expect(brief).toContain(
      "- #21 (title not printed, Untrusted text: renamed by someone; `npm run issue:read -- byro-repo 21 --body` reads it): closed",
    );
    expect(brief).not.toContain("secret");
  });

  it("takes `all` as the specs `judgeable` lists, in its order", async () => {
    addSpecOf(30, { 31: [] });
    github.reply(
      30,
      listBodyOf(31, ["- [ ] **R31.1** · Propose `decision` · a"]),
    );
    addSpecOf(20, { 21: [] });
    github.reply(
      20,
      listBodyOf(21, ["- [ ] **R21.1** · Propose `decision` · b"]),
    );
    addSpecOf(10, { 11: [] });

    const brief = await judgeBrief("all");

    const headings = brief.split("\n").filter((line) => line.startsWith("# "));
    expect(headings).toEqual([
      "# byro-repo #20 Ticket 20",
      "# byro-repo #30 Ticket 30",
    ]);
  });

  it("says so when `all` finds nothing to judge", async () => {
    addSpecOf(10, {});

    expect(await judgeBrief("all")).toBe("Nothing in byro-repo needs judging.");
  });

  it("words a failed `all` listing as its own", async () => {
    github.failuresLeft = 1;

    expect(await judgeBrief("all")).toBe(
      "No judge brief: listing byro-repo's judgeable specs failed: gh: connection reset",
    );
  });
});
