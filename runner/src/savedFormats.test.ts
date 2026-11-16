import { describe, expect, it } from "vitest";

import { factsOf, runStateOf } from "./savedFormats.ts";

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

describe("a recorded step session's start", () => {
  const recorded = { account: 1, configFolder: "/config/account-1" };
  const started = {
    agent: "review",
    sessionId: "s-2",
    startedAt: "2026-10-12T09:00:00.000Z",
    ...recorded,
  };
  const unstarted = { agent: "implement", sessionId: "s-1", ...recorded };

  it("loads from a facts file, beside a session recorded before starts were", () => {
    const facts = factsOf({ sessions: { steps: [unstarted, started] } });

    expect(facts.sessions).toEqual({ steps: [unstarted, started] });
  });

  it("loads from a run state, beside a session recorded before starts were", () => {
    const state = runStateOf({
      tickets: {
        "byro-repo #1": { step: "resolve", sessions: [unstarted, started] },
      },
    });

    expect(state.tickets["byro-repo #1"]?.sessions).toEqual([
      unstarted,
      started,
    ]);
  });
});
