import type { LeasedWorkspace } from "@byronbroughten/spec-runner/IssueWorkspaces";
import { defaultRunKnobs } from "@byronbroughten/spec-runner/runKnobs";
import { describe, expect, it } from "vitest";

import { contextNudgeKnobs, isTicketWork } from "./contextNudge.ts";

describe("contextNudgeKnobs", () => {
  it("keeps the shim's threshold at the runner's ticket-budget default", () => {
    expect(contextNudgeKnobs().ticketBudget).toBe(defaultRunKnobs.ticketBudget);
  });

  it("names this repo's handoff doc", () => {
    expect(contextNudgeKnobs().handoffDocPath).toBe(
      "docs/agents/planning.md#handoffs",
    );
  });
});

describe("isTicketWork", () => {
  const lease = { kind: "session" as const, pid: 7, isLive: true };
  const issue: LeasedWorkspace = {
    path: "/w/sheets-framework-issue-155",
    key: { repo: "sheets-framework", number: 155 },
    lease,
  };
  const session: LeasedWorkspace = {
    path: "/w/session-retro",
    key: { session: "retro" },
    lease,
  };

  it("binds a runner step, which holds no lease of its own", () => {
    expect(isTicketWork("runnerStep", [])).toBe(true);
  });

  it("binds a session holding an issue workspace", () => {
    expect(isTicketWork("interactive", [issue])).toBe(true);
    expect(isTicketWork("interactive", [session, issue])).toBe(true);
  });

  it("leaves a session workspace or no workspace to the operator", () => {
    expect(isTicketWork("interactive", [session])).toBe(false);
    expect(isTicketWork("interactive", [])).toBe(false);
  });
});
