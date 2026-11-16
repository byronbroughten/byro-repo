import { describe, expect, it } from "vitest";

import {
  contextNudgeOf,
  type ContextNudgeOptions,
  sizeAtNudgeOf,
  type SupervisionHandoff,
} from "./contextNudge.ts";

const options: ContextNudgeOptions = {
  sessionId: "abc-123",
  ticketBudget: 150_000,
  budgetMargin: 15_000,
  handoffDocPath: "docs/agents/handoffs.md#handoffs",
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

describe("sizeAtNudgeOf", () => {
  const knobs = { ticketBudget: 150_000, budgetMargin: 15_000 };

  it("stays quiet under the margin below the budget", () => {
    expect(sizeAtNudgeOf(sized(134_999), knobs)).toBeUndefined();
    expect(sizeAtNudgeOf("", knobs)).toBeUndefined();
  });

  it("gives the peak context from the margin below the budget up", () => {
    expect(sizeAtNudgeOf(sized(135_000), knobs)).toBe(135_000);
    expect(sizeAtNudgeOf(sized(297_700), knobs)).toBe(297_700);
  });

  it("reads the margin from its knobs", () => {
    const narrow = { ...knobs, budgetMargin: 5_000 };

    expect(sizeAtNudgeOf(sized(144_999), narrow)).toBeUndefined();
    expect(sizeAtNudgeOf(sized(145_000), narrow)).toBe(145_000);
  });
});

describe("contextNudgeOf", () => {
  it("names the size, rounded to thousands", () => {
    expect(contextNudgeOf(135_000, options)).toMatch(/135K tokens/);
    expect(contextNudgeOf(297_700, options)).toMatch(/298K tokens/);
  });

  it("quotes the budget itself, not the nudge point", () => {
    expect(contextNudgeOf(135_000, options)).toMatch(
      /approaching the 150K ticket budget: finish the step you are on, then hand off; /,
    );
  });

  it("reads the budget from its options", () => {
    const budget = { ...options, ticketBudget: 100_000 };

    expect(contextNudgeOf(90_000, budget)).toMatch(/approaching the 100K/);
  });

  it("asks for a handoff with no link when no handoff doc is set", () => {
    const nudge = contextNudgeOf(160_000, {
      sessionId: "abc-123",
      ticketBudget: 150_000,
      budgetMargin: 15_000,
      owed: { isTicketOwed: true },
    });

    expect(nudge).toMatch(/your next and last step: an issue comment/);
    expect(nudge).not.toMatch(/, per /);
  });

  it("points to a set handoff doc and asks for a fresh session", () => {
    const nudge = contextNudgeOf(160_000, options);

    expect(nudge).toMatch(/per docs\/agents\/handoffs\.md#handoffs/);
    expect(nudge).toMatch(/fresh session/);
    expect(nudge).toMatch(/uncommitted/);
    expect(nudge).toMatch(/ticket budget/);
  });

  it("asks the handoff comment to end with the session's id", () => {
    expect(contextNudgeOf(160_000, options)).toMatch(
      /End the handoff comment with `session: abc-123`/,
    );
  });

  describe("for a Supervisor", () => {
    const supervising: ContextNudgeOptions = {
      ...options,
      owed: { isTicketOwed: false, supervision },
    };

    it("says it is approaching the context budget, not the ticket budget", () => {
      const nudge = contextNudgeOf(140_000, supervising);

      expect(nudge).toMatch(/approaching the 150K context budget/);
      expect(nudge).not.toMatch(/ticket budget/);
    });

    it("names the handoff file and what goes in it", () => {
      const nudge = contextNudgeOf(160_000, supervising);

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
      expect(contextNudgeOf(160_000, supervising)).toMatch(
        /tell the developer to `\/clear`, then run `\/runner byronbroughten\/byro-repo 664`\.$/,
      );
    });
  });

  describe("for a Supervisor holding an issue workspace", () => {
    const both: ContextNudgeOptions = {
      ...options,
      owed: { isTicketOwed: true, supervision },
    };

    it("names both handoffs in one nudge, the ticket's first", () => {
      const nudge = contextNudgeOf(160_000, both);

      expect(nudge).toMatch(/two handoffs/);
      const ticketAt = nudge.indexOf("End the handoff comment with");
      const supervisionAt = nudge.indexOf(supervision.path);
      expect(ticketAt).toBeGreaterThan(-1);
      expect(supervisionAt).toBeGreaterThan(ticketAt);
      expect(nudge).toMatch(/per docs\/agents\/handoffs\.md#handoffs/);
    });

    it("ends with the /clear then /runner line, not a fresh session", () => {
      const nudge = contextNudgeOf(160_000, both);

      expect(nudge).toMatch(
        /then run `\/runner byronbroughten\/byro-repo 664`\.$/,
      );
      expect(nudge).not.toMatch(/fresh session/);
    });
  });
});
