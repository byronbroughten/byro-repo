import { describe, expect, it } from "vitest";

import { haltCommentOf, runnerMark } from "./halts.ts";
import {
  coveredLaterNotesOf,
  decidedListOf,
  gapCheckListOf,
  type JudgingOrder,
  judgingOrderOf,
  reReviewedCommentOf,
  reviewListHoldingOf,
  skippedReviewersNote,
  ticketReviewListOf,
  undecidedCountOf,
  undecidedLineOf,
} from "./reviewList.ts";
import type { IssueComment } from "./SpecRun.ts";
import type { ResolveRecord } from "./stepRecords.ts";

const ticket = { repo: "byro-repo", number: 7 };

const ticketPropose: ResolveRecord = {
  finding: 1,
  axis: "spec",
  where: "one.ts:1",
  claim: "Story 3 is unmet.",
  verdict: "propose",
  reason: "ticket",
  evidence: "Checked it.",
  recommendation: "File it.",
  draftIssueTitle: "Meet story 3",
};

describe("ticketReviewListOf", () => {
  it("numbers each Propose R<ticket>.<k> and carries a Propose `ticket`'s drafted title", () => {
    const body = ticketReviewListOf({
      ticket,
      title: "Ticket 7",
      records: [ticketPropose, { ...ticketPropose, finding: 2 }],
    });

    expect(body).toContain('**Review list** · byro-repo #7, "Ticket 7"');
    expect(body).toContain("**R7.1** · Propose `ticket`");
    expect(body).toContain('  Drafted issue: "Meet story 3"');
    expect(body).toContain("**R7.2**");
    expect(body).not.toContain("<details>");
  });

  it("writes a keep's drafted reason under its item", () => {
    const { draftIssueTitle: _title, ...decision } = ticketPropose;
    const body = ticketReviewListOf({
      ticket,
      title: "Ticket 7",
      records: [
        {
          ...decision,
          reason: "decision",
          recommendation: "Approve the keep.",
          draftKeepReason: "A seam for the fake stream in tests.",
        },
      ],
    });

    expect(body).toContain(
      '  Recommendation: Approve the keep.\n  Drafted keep: "A seam for the fake stream in tests."',
    );
    expect(body).not.toContain("Drafted issue:");
  });

  it("groups by axis then verdict, shows each departure with its reason, and collapses only the agreed Dismisses", () => {
    const records: ResolveRecord[] = [
      {
        finding: 1,
        axis: "spec",
        suggestedVerdict: "fix",
        where: "one.ts:1",
        claim: "Story 3 is unmet.",
        verdict: "fix",
        evidence: "Checked it.",
        quote: "one.ts:1 `x`",
        rule: "Story 3.",
      },
      {
        finding: 2,
        axis: "standards",
        suggestedVerdict: "fix",
        where: "two.ts:2",
        claim: "A smell.",
        verdict: "dismiss",
        reason: "false-positive",
        evidence: "The doc allows it.",
      },
      {
        finding: 3,
        axis: "standards",
        suggestedVerdict: "dismiss",
        where: "three.ts:3",
        claim: "Another smell.",
        verdict: "dismiss",
        reason: "tooling-enforced",
        evidence: "Lint backs it.",
      },
      {
        finding: 4,
        axis: "standards",
        suggestedVerdict: "halt",
        where: "four.ts:4",
        claim: "Two rules conflict.",
        verdict: "propose",
        reason: "decision",
        evidence: "One doc is wrong.",
        recommendation: "Keep the first.",
      },
      {
        finding: 5,
        axis: "standards",
        suggestedVerdict: "fix",
        where: "five.ts:5",
        claim: "A rename.",
        verdict: "fix",
        evidence: "Renamed it.",
        quote: "five.ts:5 `y`",
        rule: "Naming.",
      },
      {
        finding: 6,
        axis: "spec",
        suggestedVerdict: "halt",
        where: "spec",
        claim: "The spec contradicts itself.",
        verdict: "halt",
        evidence: "Stories 2 and 4.",
        recommendation: "Pick story 2.",
      },
    ];

    expect(ticketReviewListOf({ ticket, title: "Ticket 7", records })).toBe(
      [
        "<!-- review-list ticket=#7 -->",
        '**Review list** · byro-repo #7, "Ticket 7"',
        "### Standards",
        "**Fixed**\n\n- Finding 5: A rename. (five.ts:5)",
        "**Proposed**\n\n- [ ] **R7.1** · Propose `decision` · Finding 4: Two rules conflict. (four.ts:4)\n  suggested Halt → Propose: One doc is wrong.\n  Recommendation: Keep the first.",
        "**Dismissed**\n\n- Finding 2 · `false-positive` · A smell. (two.ts:2)\n  suggested Fix → Dismiss: The doc allows it.",
        "<details>\n<summary>Dismissed: 1</summary>\n\n- Finding 3 · `tooling-enforced` · Another smell. (three.ts:3). Lint backs it.\n\n</details>",
        "### Spec",
        "**Fixed**\n\n- Finding 1: Story 3 is unmet. (one.ts:1)",
        "**Halted**\n\n- Finding 6: The spec contradicts itself. (spec)\n  Evidence: Stories 2 and 4.\n  Recommendation: Pick story 2.",
      ].join("\n\n"),
    );
  });

  it("renders nothing for a ticket whose review kept no records", () => {
    expect(
      ticketReviewListOf({ ticket, title: "Ticket 7", records: [] }),
    ).toBeUndefined();
  });

  it("notes a review that skipped its reviewers under the heading, with no records and nothing undecided", () => {
    const body = ticketReviewListOf({
      ticket,
      title: "Ticket 7",
      records: [],
      hasSkippedReviewers: true,
    });

    expect(body).toBe(
      [
        "<!-- review-list ticket=#7 -->",
        '**Review list** · byro-repo #7, "Ticket 7"',
        "_Reviewed without its reviewers: the review skipped its reviewer subagents even once sent back to spawn them._",
      ].join("\n\n"),
    );
    expect(undecidedCountOf([body ?? ""]).items).toBe(0);
  });
});

describe("reReviewedCommentOf", () => {
  it("keeps a posted list's skipped-reviewers note through a re-review that spawned them, and adds one a re-review earns", () => {
    const skipped = ticketReviewListOf({
      ticket,
      title: "Ticket 7",
      records: [ticketPropose],
      hasSkippedReviewers: true,
    });
    const plain = ticketReviewListOf({
      ticket,
      title: "Ticket 7",
      records: [ticketPropose],
    });
    const second = { ...ticketPropose, finding: 2, claim: "Story 4 is unmet." };

    const kept = reReviewedCommentOf({
      ticket,
      title: "Ticket 7",
      posted: skipped ?? "",
      records: [second],
    });
    const added = reReviewedCommentOf({
      ticket,
      title: "Ticket 7",
      posted: plain ?? "",
      records: [second],
      hasSkippedReviewers: true,
    });

    expect(kept).toContain(skippedReviewersNote);
    expect(kept).toContain("**R7.2**");
    expect(added).toContain(skippedReviewersNote);
  });
});

describe("gapCheckListOf", () => {
  it("says so when the gap check found no gaps", () => {
    expect(gapCheckListOf("The spec", { gaps: [] })).toBe(
      '<!-- review-list ticket=gap-check -->\n\n**Review list** · gap check, "The spec"\n\nThe gap check found no gaps.',
    );
  });
});

describe("coveredLaterNotesOf", () => {
  it("skips a covered-later Dismiss whose ticket isn't `<repo>#<n>`", () => {
    const dismiss: ResolveRecord = {
      ...ticketPropose,
      verdict: "dismiss",
      reason: "covered-later",
      coveredBy: "the next one",
    };

    expect(coveredLaterNotesOf(ticket, [dismiss])).toEqual([]);
  });
});

describe("undecidedCountOf", () => {
  it("counts unticked items on review lists only, naming the gap check apart from the tickets", () => {
    const count = undecidedCountOf([
      "<!-- review-list ticket=#1 -->\n- [ ] **R1.1** · a\n- [x] **R1.2** · b",
      "<!-- review-list ticket=#2 -->\n- [x] **R2.1** · a",
      "<!-- review-list ticket=gap-check -->\n- [ ] **Rgap-check.1** · a\n- [ ] **Rgap-check.2** · b",
      "A Halt.\n- [ ] **R9.1** · not a review list",
    ]);

    expect(count).toEqual({ items: 3, tickets: 1, hasUndecidedGaps: true });
    expect(undecidedLineOf(count)).toBe(
      "review list: 3 undecided across 1 ticket and the gap check",
    );
  });
});

const listBody = [
  "<!-- spec-runner -->",
  "<!-- review-list ticket=#7 -->",
  "",
  "- [ ] **R7.1** · Propose `decision` · a",
  "  Evidence: e1",
  "  Recommendation: r1",
  "- [x] **R7.2** · Propose `ticket` · b",
  "  Evidence: e2",
  "  Recommendation: r2",
  "- [ ] **R7.3** · Propose `decision` · c",
  "  Evidence: e3",
  "  Recommendation: r3",
  "",
].join("\n");

describe("decidedListOf", () => {
  it("ticks the item and adds its Decided line, leaving every other line as it was", () => {
    const body = decidedListOf({
      body: listBody,
      itemId: "R7.1",
      kind: "decided",
      text: "accepted",
    });

    expect(body).toBe(
      listBody.replace(
        "- [ ] **R7.1** · Propose `decision` · a\n  Evidence: e1\n  Recommendation: r1\n",
        "- [x] **R7.1** · Propose `decision` · a\n  Evidence: e1\n  Recommendation: r1\n  Decided: accepted\n",
      ),
    );
  });

  it("adds a Handled line and leaves the box unticked", () => {
    const body = decidedListOf({
      body: listBody,
      itemId: "R7.3",
      kind: "handled",
      text: "filed #12; the rest is yours",
    });

    expect(body).toBe(
      listBody.replace(
        "  Recommendation: r3\n",
        "  Recommendation: r3\n  Handled: filed #12; the rest is yours\n",
      ),
    );
  });

  it("decides a handled item, keeping its Handled line", () => {
    const handled = decidedListOf({
      body: listBody,
      itemId: "R7.3",
      kind: "handled",
      text: "half",
    });

    const body = decidedListOf({
      body: handled,
      itemId: "R7.3",
      kind: "decided",
      text: "fix filed",
    });

    expect(body).toContain(
      "- [x] **R7.3** · Propose `decision` · c\n  Evidence: e3\n  Recommendation: r3\n  Handled: half\n  Decided: fix filed\n",
    );
  });

  it("decides a hand-ticked item, keeping its tick", () => {
    const body = decidedListOf({
      body: listBody,
      itemId: "R7.2",
      kind: "decided",
      text: "accepted (ticked by hand)",
    });

    expect(body).toContain(
      "- [x] **R7.2** · Propose `ticket` · b\n  Evidence: e2\n  Recommendation: r2\n  Decided: accepted (ticked by hand)\n- [ ] **R7.3**",
    );
  });

  it("keeps a body's CRLF line ends", () => {
    const crlf = listBody.replaceAll("\n", "\r\n");

    const body = decidedListOf({
      body: crlf,
      itemId: "R7.1",
      kind: "decided",
      text: "accepted",
    });

    expect(body).toBe(
      decidedListOf({
        body: listBody,
        itemId: "R7.1",
        kind: "decided",
        text: "accepted",
      }).replaceAll("\n", "\r\n"),
    );
  });

  it("refuses an item the list doesn't hold", () => {
    expect(() =>
      decidedListOf({
        body: listBody,
        itemId: "R7.9",
        kind: "decided",
        text: "x",
      }),
    ).toThrow("holds no item R7.9");
  });

  it("refuses an item already decided", () => {
    const decided = decidedListOf({
      body: listBody,
      itemId: "R7.1",
      kind: "decided",
      text: "accepted",
    });

    expect(() =>
      decidedListOf({
        body: decided,
        itemId: "R7.1",
        kind: "handled",
        text: "x",
      }),
    ).toThrow("R7.1 is already decided");
  });

  it("refuses a multi-line text", () => {
    expect(() =>
      decidedListOf({
        body: listBody,
        itemId: "R7.1",
        kind: "decided",
        text: "one\ntwo",
      }),
    ).toThrow("one line");
  });
});

describe("judgingOrderOf", () => {
  const developer = "byronbroughten";
  const specUrl = "https://github.com/o/byro-repo/issues/1";

  function listOf(heading: string, items: string[]): string {
    return ["<!-- spec-runner -->", heading, "", ...items, ""].join("\n");
  }

  function ticketListOf(number: number, items: string[]): string {
    return listOf(
      `<!-- review-list ticket=#${number} -->\n\n**Review list** · byro-repo #${number}, "Ticket ${number}"\n\n### Spec\n\n**Proposed**`,
      items,
    );
  }

  const gapList = listOf(
    '<!-- review-list ticket=gap-check -->\n\n**Review list** · gap check, "The spec"',
    [
      "- [ ] **Rgap-check.1** · Gap · story 5",
      "  Evidence: eg",
      "  Recommendation: rg",
      '  Drafted issue: "Meet story 5"',
    ],
  );

  function haltOf(id: string, ticket: number, blocks: string): string {
    return [
      `<!-- spec-runner -->\n**Halt ${id}** · Halt 1 of 1 · byro-repo #${ticket}, "Ticket ${ticket}" · verdict Halt`,
      "Finding 2: the secret question body.",
      `Blocks: ${blocks}.`,
      "Options:\n1. Pick one\n2. `stop spec`",
      `Answer with a reply that opens with \`${id}:\`, then an option or your own words.`,
    ].join("\n\n");
  }

  function commentsOf(
    bodies: (string | { author: string; body: string })[],
  ): IssueComment[] {
    return bodies.map((entry, index) => {
      const { author, body } =
        typeof entry === "string" ? { author: developer, body: entry } : entry;
      return {
        id: `c${index + 1}`,
        author,
        body,
        url: `${specUrl}#issuecomment-${index + 1}`,
      };
    });
  }

  function idsOf(order: JudgingOrder): [string, string[]][] {
    return order.items.map(({ id, halts }) => [id, halts]);
  }

  it("puts Halt-adjacent items first, each naming its Halt, then the other tickets' oldest first, then the gap check's", () => {
    const comments = commentsOf([
      ticketListOf(7, [
        "- [ ] **R7.1** · Propose `decision` · a",
        "  Evidence: e",
      ]),
      ticketListOf(8, [
        "- [ ] **R8.1** · Propose `decision` · b",
        "  Evidence: e",
      ]),
      gapList,
      ticketListOf(9, [
        "- [ ] **R9.1** · Propose `decision` · c",
        "- [ ] **R9.2** · Propose `decision` · d",
      ]),
      haltOf("H2", 9, "byro-repo#8 and their downstream"),
      ticketListOf(10, ["- [ ] **R10.1** · Propose `decision` · e"]),
    ]);

    expect(idsOf(judgingOrderOf(comments, developer))).toEqual([
      ["R8.1", ["H2"]],
      ["R9.1", ["H2"]],
      ["R9.2", ["H2"]],
      ["R7.1", []],
      ["R10.1", []],
      ["Rgap-check.1", []],
    ]);
  });

  it("gives each item its state, its lines in full and its comment's id and URL", () => {
    const comments = commentsOf([
      ticketListOf(7, [
        "- [ ] **R7.1** · Propose `ticket` · a",
        "  Evidence: e1",
        "  Recommendation: r1",
        '  Drafted issue: "File a"',
        "  Handled: filed #12; the rest is yours",
        "- [x] **R7.2** · Propose `decision` · b",
        "  Evidence: e2",
        "  Recommendation: r2",
        '  Drafted keep: "A seam."',
      ]),
    ]);

    expect(judgingOrderOf(comments, developer).items).toEqual([
      {
        id: "R7.1",
        state: "undecided",
        lines: [
          "- [ ] **R7.1** · Propose `ticket` · a",
          "  Evidence: e1",
          "  Recommendation: r1",
          '  Drafted issue: "File a"',
          "  Handled: filed #12; the rest is yours",
        ],
        comment: { id: "c1", url: `${specUrl}#issuecomment-1` },
        halts: [],
      },
      {
        id: "R7.2",
        state: "hand-ticked",
        lines: [
          "- [x] **R7.2** · Propose `decision` · b",
          "  Evidence: e2",
          "  Recommendation: r2",
          '  Drafted keep: "A seam."',
        ],
        comment: { id: "c1", url: `${specUrl}#issuecomment-1` },
        halts: [],
      },
    ]);
  });

  it("reads a Defer-headed list's items as Proposals", () => {
    const comments = commentsOf([
      ticketListOf(7, [
        "- [ ] **R7.1** · Defer `decision` · a",
        "  Evidence: e",
      ]),
    ]);

    expect(idsOf(judgingOrderOf(comments, developer))).toEqual([["R7.1", []]]);
  });

  it("counts decided items and anyone else's comments without giving them", () => {
    const comments = commentsOf([
      ticketListOf(7, [
        "- [x] **R7.1** · Propose `decision` · a",
        "  Decided: accepted",
        "- [ ] **R7.2** · Propose `decision` · b",
        "  Handled: half",
        "  Decided: fix filed",
        "- [ ] **R7.3** · Propose `decision` · c",
      ]),
      { author: "someone", body: ticketListOf(8, ["- [ ] **R8.1** · x"]) },
      { author: "someone", body: haltOf("H1", 7, "the whole spec") },
      { author: "someone", body: "A plain reply." },
    ]);

    const order = judgingOrderOf(comments, developer);

    expect(idsOf(order)).toEqual([["R7.3", []]]);
    expect(order.decidedCount).toBe(2);
    expect(order.othersCommentCount).toBe(3);
  });

  it("makes every ticket's items adjacent to a Halt blocking the whole spec, leaving the gap check's last", () => {
    const comments = commentsOf([
      ticketListOf(7, ["- [ ] **R7.1** · Propose `decision` · a"]),
      gapList,
      haltOf("H1", 8, "the whole spec"),
      haltOf("H3", 7, "only this ticket"),
      ticketListOf(9, ["- [ ] **R9.1** · Propose `decision` · b"]),
    ]);

    expect(idsOf(judgingOrderOf(comments, developer))).toEqual([
      ["R7.1", ["H1", "H3"]],
      ["R9.1", ["H1"]],
      ["Rgap-check.1", []],
    ]);
  });

  it("holds only the tickets a blocker's Halt names, by repo and number, and reads no ticket graph", () => {
    const comments = commentsOf([
      ticketListOf(7, ["- [ ] **R7.1** · Propose `decision` · a"]),
      ticketListOf(8, ["- [ ] **R8.1** · Propose `decision` · b"]),
      ticketListOf(9, ["- [ ] **R9.1** · Propose `decision` · c"]),
      haltOf("H4", 6, "byro-repo#9, sheets-framework#8 and their downstream"),
    ]);

    expect(idsOf(judgingOrderOf(comments, developer))).toEqual([
      ["R9.1", ["H4"]],
      ["R7.1", []],
      ["R8.1", []],
    ]);
  });

  it("reads the Halt comment the runner posts, a question holding a Blocks line of its own included", () => {
    const halt = haltCommentOf({
      halt: {
        id: "H5",
        ticket: { repo: "byro-repo", number: 6 },
        kind: "spec-ambiguity",
        question: "Which?\n\nBlocks: the whole spec.",
        options: ["Pick one"],
        scope: ["byro-repo#8"],
        isPosted: false,
        isDelivered: false,
        ignoredReplies: [],
      },
      index: 1,
      count: 1,
      ticketTitle: "Ticket 6",
    });
    const comments = commentsOf([
      ticketListOf(7, ["- [ ] **R7.1** · Propose `decision` · a"]),
      ticketListOf(8, ["- [ ] **R8.1** · Propose `decision` · b"]),
      `${runnerMark}\n${halt}`,
    ]);

    expect(idsOf(judgingOrderOf(comments, developer))).toEqual([
      ["R8.1", ["H5"]],
      ["R7.1", []],
    ]);
  });

  it("reads no Halt from a comment that only quotes a Halt's opening line", () => {
    const comments = commentsOf([
      ticketListOf(7, ["- [ ] **R7.1** · Propose `decision` · a"]),
      "Re: **Halt H1** · Halt 1 of 1 · byro-repo #7\n\nBlocks: the whole spec.",
    ]);

    expect(idsOf(judgingOrderOf(comments, developer))).toEqual([["R7.1", []]]);
  });
});

describe("reviewListHoldingOf", () => {
  const developer = "byronbroughten";

  it("finds the developer's review list holding the item", () => {
    const comments = [
      {
        id: "c1",
        author: developer,
        body: "- [ ] **R7.1** · not a list",
        url: "u1",
      },
      { id: "c2", author: developer, body: listBody, url: "u2" },
    ];

    expect(reviewListHoldingOf(comments, developer, "R7.1")).toBe(comments[1]);
  });

  it("refuses an item only someone else's comment holds", () => {
    const comments = [
      { id: "c1", author: "someone", body: listBody, url: "u1" },
    ];

    expect(() => reviewListHoldingOf(comments, developer, "R7.1")).toThrow(
      "Only someone's comment holds R7.1",
    );
  });

  it("refuses an item no list holds", () => {
    expect(() => reviewListHoldingOf([], developer, "R7.1")).toThrow(
      "No review list of byronbroughten's holds R7.1",
    );
  });
});
