import { describe, expect, it } from "vitest";

import { runStateOf } from "./savedFormats.ts";

// Master's runner reads and saves run states a branch's newer runner wrote.
describe("runStateOf on a field a newer runner wrote", () => {
  it("keeps it on the run, each ticket, each session and each halt", () => {
    const saved = {
      newerRunFact: "kept",
      tickets: {
        "byro-repo #1": {
          step: "review",
          newerTicketFact: "kept",
          sessions: [
            { agent: "implement", sessionId: "s-1", newerSessionFact: "kept" },
          ],
        },
      },
      halts: [{ id: "S1.1", failedStep: "review", newerHaltFact: "kept" }],
    };

    expect(runStateOf(saved)).toMatchObject(saved);
  });
});
