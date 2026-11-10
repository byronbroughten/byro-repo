import { describe, expect, it } from "vitest";

import {
  contextNudgeOf,
  type ContextNudgeOptions,
  isPastTicketBudget,
  type SupervisionHandoff,
} from "./contextNudge.ts";

const options: ContextNudgeOptions = {
  sessionId: "abc-123",
  ticketBudget: 150_000,
  handoffDocPath: "docs/agents/planning.md#handoffs",
  owed: { isTicketOwed: true },
};

const supervision: SupervisionHandoff = {
  path: "/p/.runner/supervision/byro-repo-664.handoff.md",
  rejoinCommand: "/runner byronbroughten/byro-repo 664",
};

function sized(tokens: number): string {
  const line = JSON.stringify({
    type: "assistant",
    message: {
      role: "assistant",
      usage: { input_tokens: 1, cache_read_input_tokens: tokens - 1 },
    },
  });
  return `${line}\n`;
}

describe("isPastTicketBudget", () => {
  it("passes at the budget and not under it", () => {
    expect(isPastTicketBudget(sized(149_999), 150_000)).toBe(false);
    expect(isPastTicketBudget(sized(150_000), 150_000)).toBe(true);
    expect(isPastTicketBudget("", 150_000)).toBe(false);
  });
});

describe("contextNudgeOf", () => {
  it("stays quiet under the ticket budget", () => {
    expect(contextNudgeOf(sized(149_999), options)).toBeUndefined();
    expect(contextNudgeOf("", options)).toBeUndefined();
  });

  it("stays quiet when the session owes no handoff", () => {
    const owed = { ...options, owed: { isTicketOwed: false } };

    expect(contextNudgeOf(sized(160_000), owed)).toBeUndefined();
  });

  it("nudges at and over the ticket budget, naming the size", () => {
    expect(contextNudgeOf(sized(150_000), options)).toMatch(/150K/);
    expect(contextNudgeOf(sized(297_700), options)).toMatch(/298K/);
  });

  it("reads the budget from its options", () => {
    const budget = { ...options, ticketBudget: 100_000 };

    expect(contextNudgeOf(sized(99_999), budget)).toBeUndefined();
    expect(contextNudgeOf(sized(100_000), budget)).toMatch(/past the 100K/);
  });

  it("asks for a handoff with no link when no handoff doc is set", () => {
    const nudge = contextNudgeOf(sized(160_000), {
      sessionId: "abc-123",
      ticketBudget: 150_000,
      owed: { isTicketOwed: true },
    });

    expect(nudge).toMatch(/your next and last step: an issue comment/);
    expect(nudge).not.toMatch(/, per /);
  });

  it("points to a set handoff doc and asks for a fresh session", () => {
    const nudge = contextNudgeOf(sized(160_000), options);

    expect(nudge).toMatch(/per docs\/agents\/planning\.md#handoffs/);
    expect(nudge).toMatch(/fresh session/);
    expect(nudge).toMatch(/uncommitted/);
    expect(nudge).toMatch(/ticket budget/);
  });

  it("asks the handoff comment to end with the session's id", () => {
    expect(contextNudgeOf(sized(160_000), options)).toMatch(
      /End the handoff comment with `session: abc-123`/,
    );
  });

  describe("for a Supervisor", () => {
    const supervising = {
      ...options,
      owed: { isTicketOwed: false, supervision },
    };

    it("says it is past the context budget, not the ticket budget", () => {
      const nudge = contextNudgeOf(sized(160_000), supervising);

      expect(nudge).toMatch(/past the 150K context budget/);
      expect(nudge).not.toMatch(/ticket budget/);
    });

    it("names the handoff file and what goes in it", () => {
      const nudge = contextNudgeOf(sized(160_000), supervising);

      expect(nudge).toContain(`write \`${supervision.path}\``);
      expect(nudge).toContain(
        "opens with the `/runner byronbroughten/byro-repo 664` line",
      );
      expect(nudge).toMatch(/suggested replies the developer hasn't settled/);
      expect(nudge).toMatch(/standing instructions the developer gave in chat/);
      expect(nudge).toMatch(/work in progress/);
      expect(nudge).toMatch(/no event history or run summary/);
    });

    it("ends by telling the developer to /clear, then run /runner", () => {
      expect(contextNudgeOf(sized(160_000), supervising)).toMatch(
        /tell the developer to `\/clear`, then run `\/runner byronbroughten\/byro-repo 664`\.$/,
      );
    });
  });

  describe("for a Supervisor holding an issue workspace", () => {
    const both = { ...options, owed: { isTicketOwed: true, supervision } };

    it("names both handoffs in one nudge, the ticket's first", () => {
      const nudge = contextNudgeOf(sized(160_000), both) ?? "";

      expect(nudge).toMatch(/two handoffs/);
      const ticketAt = nudge.indexOf("End the handoff comment with");
      const supervisionAt = nudge.indexOf(supervision.path);
      expect(ticketAt).toBeGreaterThan(-1);
      expect(supervisionAt).toBeGreaterThan(ticketAt);
      expect(nudge).toMatch(/per docs\/agents\/planning\.md#handoffs/);
    });

    it("ends with the /clear then /runner line, not a fresh session", () => {
      const nudge = contextNudgeOf(sized(160_000), both);

      expect(nudge).toMatch(
        /then run `\/runner byronbroughten\/byro-repo 664`\.$/,
      );
      expect(nudge).not.toMatch(/fresh session/);
    });
  });
});
