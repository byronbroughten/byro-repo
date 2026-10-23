import { existsSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { beforeEach, describe, expect, it } from "vitest";

import { FactsFile } from "./FactsFile.ts";
import { FakeAgentStep } from "./FakeAgentStep.ts";
import type { TriageRecord } from "./findingTriage.ts";
import { git } from "./GitFixture.ts";
import type { LeaseHolder } from "./IssueWorkspaces.ts";
import {
  addSpec,
  crashed,
  findingOf,
  github,
  haltComments,
  implemented,
  notices,
  refOf,
  resolved,
  reviewed,
  runStatePath,
  spec,
  specRun,
  stateFolder,
  type StepScript,
  ticketFacts,
  useSpecRunHarness,
} from "./specRunHarness.ts";

useSpecRunHarness();

describe("review of one ticket outside a run", () => {
  const holder: LeaseHolder = { kind: "session", pid: process.ppid };

  // An interactive session's workspace, with its work committed and its lease held.
  beforeEach(async () => {
    addSpec([1, 2]);
    const { workspaces } = specRun(FakeAgentStep.init());
    const workspace = await workspaces.create(refOf(1));
    writeFileSync(join(workspace.path, "one.ts"), "export {};\n");
    git(workspace.path, "add", "one.ts");
    git(workspace.path, "commit", "-m", "Add one.ts");
    await workspaces.takeLease(workspace, holder);
  });

  const findings = [findingOf(1), findingOf(2), findingOf(3)];

  function base(finding: number): Omit<TriageRecord, "verdict"> {
    return {
      finding,
      axis: "standards",
      where: `one.ts:${finding}`,
      claim: `Line ${finding} is wrong.`,
      evidence: "Checked it.",
    };
  }

  const propose: TriageRecord = {
    ...base(1),
    verdict: "propose",
    reason: "decision",
    recommendation: "Pick the first.",
  };
  const fix: TriageRecord = {
    ...base(2),
    verdict: "fix",
    quote: "one.ts:2 `export {};`",
    rule: "config/docs/code-style.md: a rule.",
  };
  const coveredLater: TriageRecord = {
    ...base(3),
    verdict: "dismiss",
    reason: "covered-later",
    coveredBy: "byro-repo#2",
  };

  const halt: TriageRecord = {
    ...base(1),
    verdict: "halt",
    recommendation: "Answer it.",
  };

  function triaged(...records: TriageRecord[]): StepScript {
    return resolved(records);
  }

  function reviewsWithFix(file = "fix.ts"): FakeAgentStep {
    return FakeAgentStep.init(
      reviewed(findings),
      resolved([propose, fix, coveredLater], file),
    );
  }

  function commentsOn(number: number, mark: string): string[] {
    return github.comments
      .filter(({ issue }) => issue.number === number)
      .map(({ body }) => body)
      .filter((body) => body.includes(mark));
  }

  it("writes reviewFixes none and posts nothing when the review finds nothing", async () => {
    const result = await specRun(FakeAgentStep.init(reviewed())).review(
      refOf(1),
      { holder },
    );

    expect(result).toMatchObject({ kind: "reviewed", halts: [] });
    expect(ticketFacts()).toEqual({ reviewFixes: "none", proposals: 0 });
    expect(github.comments).toEqual([]);
  });

  it("posts the run's review list and covered-later note, and writes the same review facts, a fresh resolver fixing", async () => {
    const result = await specRun(reviewsWithFix()).review(refOf(1), {
      holder,
    });

    expect(result).toMatchObject({ kind: "reviewed", halts: [] });
    const [list] = commentsOn(213, "<!-- review-list ");
    expect(list).toContain("<!-- review-list ticket=#1 -->");
    expect(list).toContain(
      "- [ ] **R1.1** · Propose `decision` · Finding 1: Line 1 is wrong. (one.ts:1)",
    );
    expect(commentsOn(2, "byro-repo#1's review left this")).toHaveLength(1);
    expect(ticketFacts()).toEqual({
      reviewFixes: "triage",
      whatReviewCaught:
        "Fixed: Line 2 is wrong. (one.ts:2). Proposed: Line 1 is wrong. (one.ts:1).",
      proposals: 1,
    });
  });

  it("records the review and resolve sessions it started beside the implement session, under its account and config folder", async () => {
    FactsFile.init(stateFolder()).addSession(refOf(1), {
      account: 2,
      configFolder: "/config/account-2",
      step: { agent: "implement", sessionId: "implement-session" },
    });
    const agentStep = FakeAgentStep.init(
      { ...reviewed(findings), sessionId: "review-session" },
      async (request) => ({
        ...(await resolved([propose, fix, coveredLater], "fix.ts")(request)),
        sessionId: "resolve-session",
      }),
    );

    await specRun(agentStep).review(refOf(1), { holder });

    expect(ticketFacts().sessions).toEqual({
      account: 2,
      configFolder: "/config/account-2",
      steps: [
        { agent: "implement", sessionId: "implement-session" },
        { agent: "review", sessionId: "review-session" },
        { agent: "fix", sessionId: "resolve-session" },
      ],
    });
  });

  it("records a halted review's sessions under the step's own config folder when no implement session was recorded", async () => {
    const agentStep = FakeAgentStep.init(
      {
        ...reviewed(findings.slice(0, 1)),
        sessionId: "review-session",
        configFolder: "/config/account-1",
      },
      async (request) => ({
        ...(await triaged(halt)(request)),
        sessionId: "resolve-session",
      }),
    );

    const result = await specRun(agentStep).review(refOf(1), { holder });

    expect(result.kind).toBe("halted");
    expect(ticketFacts().sessions).toEqual({
      account: 1,
      configFolder: "/config/account-1",
      steps: [
        { agent: "review", sessionId: "review-session" },
        { agent: "fix", sessionId: "resolve-session" },
      ],
    });
  });

  it("finds its markers on a second review and posts nothing twice", async () => {
    await specRun(reviewsWithFix()).review(refOf(1), { holder });

    const result = await specRun(reviewsWithFix("fix-again.ts")).review(
      refOf(1),
      { holder },
    );

    expect(result.kind).toBe("reviewed");
    expect(commentsOn(213, "<!-- review-list ")).toHaveLength(1);
    expect(commentsOn(2, "byro-repo#1's review left this")).toHaveLength(1);
  });

  it("posts a Halt verdict on the spec as a session Halt, returns it to print and pushes nothing", async () => {
    const agentStep = FakeAgentStep.init(
      reviewed(findings.slice(0, 1)),
      triaged(halt),
    );

    const result = await specRun(agentStep).review(refOf(1), { holder });

    expect(result.kind).toBe("halted");
    expect(result.message).toContain("halted on Halt S1.1");
    const halts = commentsOn(213, "**Halt S1.1**");
    expect(halts).toHaveLength(1);
    expect(result.halts).toHaveLength(1);
    expect(halts[0]).toContain(result.halts[0]);
    expect(result.halts[0]).toContain(
      '**Halt S1.1** · Halt 1 of 1 · byro-repo #1, "Ticket 1" · triage Halt',
    );
    expect(result.halts[0]).toContain("Options:\n1. Answer it.\n\n");
    expect(result.halts[0]).not.toContain("stop spec");
    expect(notices.sent).toEqual([]);
    expect(ticketFacts()).toEqual({
      reviewFixes: "none",
      whatReviewCaught: "Halted: Line 1 is wrong. (one.ts:1).",
      proposals: 0,
    });
  });

  it("offers a failed step's session Halt only a fresh review, since no run reads `retry`", async () => {
    const agentStep = FakeAgentStep.init(crashed, crashed);

    const result = await specRun(agentStep).review(refOf(1), { holder });

    expect(result.kind).toBe("halted");
    expect(result.halts[0]).toContain("Failure Halt");
    expect(result.halts[0]).toContain(
      "Options:\n1. Review the ticket again once the failure's cause is fixed.\n\n",
    );
    expect(result.halts[0]).not.toContain("`retry`");
  });

  it("leaves a later run on the spec unaffected: it saves no run state, and a reply to its Halt answers none of the run's", async () => {
    const reviewing = specRun(
      FakeAgentStep.init(reviewed(findings.slice(0, 1)), triaged(halt)),
    );
    await reviewing.review(refOf(1), { holder });
    expect(existsSync(runStatePath())).toBe(false);
    const workspace = await reviewing.workspaces.find(refOf(1));
    if (workspace) await reviewing.workspaces.releaseLease(workspace);
    await specRun(
      FakeAgentStep.init(
        implemented("two.ts"),
        reviewed(findings.slice(0, 1)),
        triaged(halt),
      ),
    ).run(spec);
    github.reply(213, "S1.1: read it the first way.");
    const agentStep = FakeAgentStep.init();

    await specRun(agentStep).run(spec);

    expect(haltComments()).toEqual([
      expect.stringContaining("**Halt H1** · Halt 1 of 1 · byro-repo #1"),
    ]);
    expect(commentsOn(213, "answered")).toEqual([]);
    expect(agentStep.requests).toHaveLength(0);
  });

  it("refuses while another session holds the workspace's lease, launching nothing", async () => {
    const agentStep = FakeAgentStep.init(reviewed());

    const result = await specRun(agentStep).review(refOf(1), {
      holder: { kind: "session", pid: process.pid },
    });

    expect(result).toEqual({
      kind: "refused",
      message: `byro-repo #1's workspace is leased by a session (pid ${process.ppid}).`,
      halts: [],
    });
    expect(agentStep.requests).toHaveLength(0);
  });

  it("refuses a workspace with uncommitted changes, which the fix step could reset away", async () => {
    const workspace = await specRun(FakeAgentStep.init()).workspaces.find(
      refOf(1),
    );
    writeFileSync(join(workspace?.path ?? "", "one.ts"), "unsaved\n");
    const agentStep = FakeAgentStep.init(reviewed());

    const result = await specRun(agentStep).review(refOf(1), { holder });

    expect(result.kind).toBe("refused");
    expect(result.message).toBe(
      "byro-repo #1's workspace has uncommitted changes in byro-repo; commit them first.",
    );
    expect(agentStep.requests).toHaveLength(0);
  });

  it("numbers a later review's Halts on from the ticket's earlier ones, so no two share an id", async () => {
    function halting(): FakeAgentStep {
      return FakeAgentStep.init(reviewed(findings.slice(0, 1)), triaged(halt));
    }
    await specRun(halting()).review(refOf(1), { holder });

    const result = await specRun(halting()).review(refOf(1), { holder });

    expect(result.message).toContain("halted on Halt S1.2");
    expect(commentsOn(213, "**Halt S1.")).toEqual([
      expect.stringContaining("**Halt S1.1**"),
      expect.stringContaining("**Halt S1.2**"),
    ]);
  });
});
