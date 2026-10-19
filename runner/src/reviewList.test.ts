import { describe, expect, it } from "vitest";

import type { TriageRecord } from "./findingTriage.ts";
import {
  coveredLaterNotesOf,
  gapCheckListOf,
  ticketReviewListOf,
  undecidedCountOf,
  undecidedLineOf,
} from "./reviewList.ts";

const ticket = { repo: "byro-repo", number: 7 };

const ticketPropose: TriageRecord = {
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
    const dismiss: TriageRecord = {
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
