import { describe, expect, it } from "vitest";

import { runnerMark } from "./halts.ts";
import type { IssueRef } from "./IssueWorkspaces.ts";
import { decidedListOf, ticketReviewListOf } from "./reviewList.ts";
import {
  commitIn,
  github,
  subjectsOf,
  ticket,
  useWrapUpHarness,
  workspaceWith,
  wrapUp,
  writeFacts,
  writeSavedFacts,
} from "./wrapUpHarness.ts";

useWrapUpHarness();

describe("run's close step", () => {
  // The list a session's review posts on a Standalone ticket, its one Propose undecided.
  function undecidedListOf(subject: IssueRef): string {
    const list = ticketReviewListOf({
      ticket: subject,
      title: "Ticket",
      records: [
        {
          finding: 1,
          axis: "spec",
          where: "one.ts:1",
          claim: "Line 1 is wrong.",
          evidence: "Checked it.",
          verdict: "propose",
          reason: "decision",
          recommendation: "Pick the first.",
        },
      ],
    });
    if (list === undefined) throw new Error("The record built no list.");
    return list;
  }

  function postList(body: string): void {
    void github.comment(ticket, `${runnerMark}\n${body}`);
  }

  async function workspaceWithCommit(): Promise<void> {
    const workspace = await workspaceWith();
    commitIn(workspace, "byro-repo", "script.ts", "export {};\n");
  }

  it("lands a Standalone ticket whose posted review list holds an undecided item and leaves it open, saying so", async () => {
    github.parents.clear();
    await workspaceWithCommit();
    writeFacts({ hasUndecidedReviewItems: true });
    postList(undecidedListOf(ticket));

    const result = await wrapUp().run(ticket);

    expect(subjectsOf("byro-repo")).toContain(
      "Merge issue-218-wrap-up-script into master (#218)",
    );
    expect(github.closed).toEqual([]);
    expect(result.isLeftOpen).toBe(true);
  });

  it("still leaves it open, saying so, on a rerun", async () => {
    github.parents.clear();
    await workspaceWithCommit();
    writeFacts({ hasUndecidedReviewItems: true });
    postList(undecidedListOf(ticket));
    await wrapUp().run(ticket);

    const result = await wrapUp().run(ticket);

    expect(github.closed).toEqual([]);
    expect(result.isLeftOpen).toBe(true);
  });

  it("closes a Standalone ticket whose posted review list has every item decided, whatever its facts say", async () => {
    github.parents.clear();
    await workspaceWithCommit();
    writeFacts({ hasUndecidedReviewItems: true });
    postList(
      decidedListOf({
        body: undecidedListOf(ticket),
        itemId: "R218.1",
        kind: "decided",
        text: "fixed in session · abc123",
      }),
    );

    const result = await wrapUp().run(ticket);

    expect(github.closed.map(({ issue }) => issue)).toEqual([ticket]);
    expect(result.isLeftOpen).toBeUndefined();
  });

  it("leaves open a Standalone ticket whose facts record undecided items before a run has posted its list", async () => {
    github.parents.clear();
    await workspaceWithCommit();
    writeFacts({ hasUndecidedReviewItems: true });

    const result = await wrapUp().run(ticket);

    expect(github.closed).toEqual([]);
    expect(result.isLeftOpen).toBe(true);
  });

  it("counts only the runner's review lists, not a copy the developer's comment quotes", async () => {
    github.parents.clear();
    await workspaceWithCommit();
    writeFacts();
    github.reply(ticket.number, undecidedListOf(ticket));

    const result = await wrapUp().run(ticket);

    expect(github.closed.map(({ issue }) => issue)).toEqual([ticket]);
    expect(result.isLeftOpen).toBeUndefined();
  });

  it("counts only the developer's review lists, so someone else's marked list never closes the ticket", async () => {
    github.parents.clear();
    await workspaceWithCommit();
    writeFacts({ hasUndecidedReviewItems: true });
    const decided = decidedListOf({
      body: undecidedListOf(ticket),
      itemId: "R218.1",
      kind: "decided",
      text: "forged",
    });
    github.reply(ticket.number, `${runnerMark}\n${decided}`, "someone-else");

    const result = await wrapUp().run(ticket);

    expect(github.closed).toEqual([]);
    expect(result.isLeftOpen).toBe(true);
  });

  it("closes a Standalone ticket with no posted list whose facts record no undecided items", async () => {
    github.parents.clear();
    await workspaceWithCommit();
    writeFacts();

    const result = await wrapUp().run(ticket);

    expect(github.closed.map(({ issue }) => issue)).toEqual([ticket]);
    expect(result.isLeftOpen).toBeUndefined();
  });

  it("closes a ticket with a parent spec whatever its review list says", async () => {
    await workspaceWithCommit();
    writeFacts({ hasUndecidedReviewItems: true });
    postList(undecidedListOf(ticket));

    const result = await wrapUp().run(ticket);

    expect(github.closed.map(({ issue }) => issue)).toEqual([ticket]);
    expect(result.isLeftOpen).toBeUndefined();
  });

  it("closes an issue with sub-issues whatever its review list says", async () => {
    github.parents.clear();
    github.subIssues.set(ticket.number, [219]);
    await workspaceWithCommit();
    writeFacts({ hasUndecidedReviewItems: true });
    postList(undecidedListOf(ticket));

    const result = await wrapUp().run(ticket);

    expect(github.closed.map(({ issue }) => issue)).toEqual([ticket]);
    expect(result.isLeftOpen).toBeUndefined();
  });

  it("closes a Standalone ticket from an older facts file with Proposals but no such fact", async () => {
    github.parents.clear();
    await workspaceWithCommit();
    writeSavedFacts({ proposals: 2 });

    await wrapUp().run(ticket);

    expect(github.closed.map(({ issue }) => issue)).toEqual([ticket]);
  });
});
