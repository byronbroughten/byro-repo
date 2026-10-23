import { describe, expect, it } from "vitest";

import type { ResolveRecord } from "./resolveStep.ts";
import {
  coveredLaterNotesOf,
  gapCheckListOf,
  ticketReviewListOf,
  undecidedCountOf,
  undecidedLineOf,
} from "./reviewList.ts";

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
