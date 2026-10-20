import { describe, expect, it } from "vitest";

import { overlapHits } from "./overlapHits.ts";

const fannieMae = {
  name: "fannie-mae.md",
  text: "Lending limits apply. The borrower may not exceed ten financed properties at closing.",
};

describe("overlapHits", () => {
  it("reports a verbatim run of four or more words with its sentence and passage", () => {
    const deliverable =
      "# Business Need\n\nThe target stays at ten. Each investor may not exceed ten financed properties under that rule.";
    expect(
      overlapHits({ deliverable, passages: [fannieMae], allowlist: [] }),
    ).toEqual([
      {
        run: "may not exceed ten financed properties",
        wordCount: 6,
        passageName: "fannie-mae.md",
        sentence:
          "Each investor may not exceed ten financed properties under that rule.",
        passageSentence:
          "The borrower may not exceed ten financed properties at closing.",
        isOnlyFigures: false,
      },
    ]);
  });

  it("drops a run made only of common function words", () => {
    const passages = [
      { name: "phases.md", text: "Funding is set at the start of the year." },
    ];
    expect(
      overlapHits({
        deliverable: "The sponsor will delay the start of the build.",
        passages,
        allowlist: [],
      }),
    ).toEqual([]);
  });

  it("still finds copied wording that overlaps a dropped function-word run", () => {
    const passages = [
      {
        name: "lease.md",
        text: "We met at the end of the day. Notice is due before the end of the lease term.",
      },
    ];
    const hits = overlapHits({
      deliverable: "Rent rises at the end of the lease term.",
      passages,
      allowlist: [],
    });
    expect(hits.map((hit) => hit.run)).toEqual(["the end of the lease term"]);
  });

  it("never matches an allowlisted term, so only the copied wording around it counts", () => {
    const passages = [
      {
        name: "hud.md",
        text: "Under the Housing Choice Voucher program the agency pays the owner directly each month.",
      },
    ];
    const hits = overlapHits({
      deliverable:
        "In the Housing Choice Voucher program, the agency pays the owner directly.",
      passages,
      allowlist: ["Housing Choice Voucher program"],
    });
    expect(hits.map((hit) => hit.run)).toEqual([
      "the agency pays the owner directly",
    ]);
  });

  it("matches across differences in case, punctuation, apostrophes and ligatures", () => {
    const passages = [
      {
        name: "inspection.pdf.txt",
        text: "The owner's well-being clause: ﬁnanced units, if any, must pass.",
      },
    ];
    const hits = overlapHits({
      deliverable:
        "Under THE OWNER’S WELL BEING clause — financed units — the city inspects.",
      passages,
      allowlist: [],
    });
    expect(hits.map((hit) => [hit.run, hit.wordCount])).toEqual([
      ["the owners well being clause financed units", 7],
    ]);
  });

  it("marks a run whose only content is dates and figures", () => {
    const passages = [
      {
        name: "notice.md",
        text: "The rule takes effect on January 1, 2027 for every unit.",
      },
    ];
    const hits = overlapHits({
      deliverable: "Funding is checked on January 1, 2027, before the build.",
      passages,
      allowlist: [],
    });
    expect(hits.map((hit) => [hit.run, hit.isOnlyFigures])).toEqual([
      ["on january 1 2027", true],
    ]);
  });
});
