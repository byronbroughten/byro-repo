import type {
  IssueRef,
  LeasedWorkspace,
} from "@byronbroughten/spec-runner/IssueWorkspaces";
import { defaultRunKnobs } from "@byronbroughten/spec-runner/runKnobs";
import type { SupervisionRecord } from "@byronbroughten/spec-runner/SupervisionRecords";
import { describe, expect, it } from "vitest";

import {
  type BudgetedSession,
  contextNudgeKnobs,
  owedHandoffsOf,
} from "./contextNudge.ts";

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

describe("owedHandoffsOf", () => {
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
  const record: SupervisionRecord = {
    pid: 7,
    owner: "byronbroughten",
    members: [
      { repo: "byro-repo", number: 664 },
      { repo: "byro-repo", number: 680 },
    ],
    offset: 3,
  };
  function handoffPathOf({ repo, number }: IssueRef): string {
    return `/s/${repo}-${number}.handoff.md`;
  }
  function owedOf(bound: Partial<BudgetedSession>) {
    return owedHandoffsOf(
      { mode: "interactive", held: [], record: undefined, ...bound },
      handoffPathOf,
    );
  }
  const supervision = {
    path: "/s/byro-repo-664.handoff.md",
    rejoinCommand: "/runner byronbroughten/byro-repo 664",
  };

  it("binds a runner step, which holds no lease of its own", () => {
    expect(owedOf({ mode: "runnerStep" })).toEqual({ isTicketOwed: true });
  });

  it("never takes a runner step for a Supervisor", () => {
    expect(owedOf({ mode: "runnerStep", record })).toEqual({
      isTicketOwed: true,
    });
  });

  it("binds a session holding an issue workspace", () => {
    expect(owedOf({ held: [issue] })).toEqual({ isTicketOwed: true });
    expect(owedOf({ held: [session, issue] })).toEqual({ isTicketOwed: true });
  });

  it("leaves a session workspace or no workspace to the operator", () => {
    expect(owedOf({ held: [session] })).toBeUndefined();
    expect(owedOf({})).toBeUndefined();
  });

  it("binds a Supervisor, naming its spec's or Batch's handoff by its lead", () => {
    expect(owedOf({ record })).toEqual({ isTicketOwed: false, supervision });
  });

  it("leaves a session whose supervision has ended to the operator", () => {
    expect(owedOf({ record: { ...record, endedBy: "clear" } })).toBeUndefined();
  });

  it("owes both handoffs from a Supervisor holding an issue workspace", () => {
    expect(owedOf({ held: [issue], record })).toEqual({
      isTicketOwed: true,
      supervision,
    });
  });
});
