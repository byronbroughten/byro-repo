import { existsSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { beforeEach, describe, expect, it } from "vitest";

import { FactsFile } from "./FactsFile.ts";
import { FakeAgentStep } from "./FakeAgentStep.ts";
import { git } from "./GitFixture.ts";
import type { LeaseHolder } from "./IssueWorkspaces.ts";
import type { UsageReader } from "./limitGuard.ts";
import type { ResolveRecord } from "./resolveStep.ts";
import type { ItemDecision } from "./reviewList.ts";
import { runKnobsOf } from "./runKnobs.ts";
import { reviewPrintoutOf } from "./SpecRun.ts";
import {
  addSpec,
  clonePaths,
  commentsOn,
  crashed,
  findingOf,
  github,
  greenUnlessRed,
  haltComments,
  implemented,
  notices,
  passes,
  progressLines,
  refOf,
  resolved,
  reviewed,
  runStatePath,
  spec,
  specRun,
  stateFolder,
  type StepScript,
  ticketFacts,
  usageListOf,
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

  function base(finding: number): Omit<ResolveRecord, "verdict"> {
    return {
      finding,
      axis: "standards",
      where: `one.ts:${finding}`,
      claim: `Line ${finding} is wrong.`,
      evidence: "Checked it.",
    };
  }

  const propose: ResolveRecord = {
    ...base(1),
    verdict: "propose",
    reason: "decision",
    recommendation: "Pick the first.",
  };
  const fix: ResolveRecord = {
    ...base(2),
    verdict: "fix",
    quote: "one.ts:2 `export {};`",
    rule: "config/docs/code-style.md: a rule.",
  };
  const coveredLater: ResolveRecord = {
    ...base(3),
    verdict: "dismiss",
    reason: "covered-later",
    coveredBy: "byro-repo#2",
  };

  const halt: ResolveRecord = {
    ...base(1),
    verdict: "halt",
    recommendation: "Answer it.",
  };

  function resolvedAs(...records: ResolveRecord[]): StepScript {
    return resolved(records);
  }

  function reviewsWithFix(file = "fix.ts"): FakeAgentStep {
    return FakeAgentStep.init(
      reviewed(findings),
      resolved([propose, fix, coveredLater], file),
    );
  }

  it("writes reviewFixes none and posts nothing when the review finds nothing", async () => {
    const result = await specRun(FakeAgentStep.init(reviewed())).review(
      refOf(1),
      { holder },
    );

    expect(result).toMatchObject({ kind: "reviewed", halts: [] });
    expect(ticketFacts()).toMatchObject({ reviewFixes: "none", proposals: 0 });
    expect(ticketFacts().hasUndecidedReviewItems).toBeUndefined();
    expect(github.comments).toEqual([]);
  });

  it("prints the run's review list and posts it on the spec, posts the covered-later note, and writes the same review facts, a fresh resolver fixing", async () => {
    const result = await specRun(reviewsWithFix()).review(refOf(1), {
      holder,
    });

    expect(result).toMatchObject({ kind: "reviewed", halts: [] });
    expect(commentsOn(213, "<!-- review-list ")).toEqual([
      expect.stringContaining(result.reviewList ?? "no list"),
    ]);
    expect(reviewPrintoutOf(result)).toBe(
      [
        "Reviewed byro-repo #1, findings: 3. Fixed: Line 2 is wrong. (one.ts:2). Proposed: Line 1 is wrong. (one.ts:1).",
        "<!-- review-list ticket=#1 -->",
        '**Review list** · byro-repo #1, "Ticket 1"',
        "### Standards",
        "**Fixed**\n\n- Finding 2: Line 2 is wrong. (one.ts:2)",
        "**Proposed**\n\n- [ ] **R1.1** · Propose `decision` · Finding 1: Line 1 is wrong. (one.ts:1)\n  suggested Fix → Propose: Checked it.\n  Recommendation: Pick the first.",
        "**Dismissed**\n\n- Finding 3 · `covered-later` · Line 3 is wrong. (one.ts:3). Covered by byro-repo#2.\n  suggested Fix → Dismiss: Checked it.",
      ].join("\n\n"),
    );
    expect(commentsOn(2, "byro-repo#1's review left this")).toHaveLength(1);
    expect(ticketFacts()).toMatchObject({
      reviewFixes: "fresh",
      whatReviewCaught:
        "Fixed: Line 2 is wrong. (one.ts:2). Proposed: Line 1 is wrong. (one.ts:1).",
      proposals: 1,
      hasUndecidedReviewItems: true,
    });
  });

  it("records the review and resolve sessions beside the implement session, each under the account and config folder it ran as", async () => {
    const implement = {
      agent: "implement",
      sessionId: "implement-session",
      account: 2,
      configFolder: "/config/account-2",
    } as const;
    FactsFile.init(stateFolder()).addSession(refOf(1), implement);
    const agentStep = FakeAgentStep.init(
      { ...reviewed(findings), sessionId: "review-session" },
      async (request) => ({
        ...(await resolved([propose, fix, coveredLater], "fix.ts")(request)),
        sessionId: "resolve-session",
      }),
    );

    await specRun(agentStep).review(refOf(1), { holder });

    const accountOne = { account: 1, configFolder: "/config/account-1" };
    expect(ticketFacts().sessions).toEqual({
      steps: [
        implement,
        { agent: "review", sessionId: "review-session", ...accountOne },
        { agent: "resolve", sessionId: "resolve-session", ...accountOne },
      ],
    });
  });

  it("records each step session under the account its own step ran as, in the runner's own config folder", async () => {
    const agentStep = FakeAgentStep.init(
      { ...reviewed(findings), sessionId: "review-session", account: 2 },
      async (request) => ({
        ...(await resolved([propose, fix, coveredLater], "fix.ts")(request)),
        sessionId: "resolve-session",
      }),
    );

    await specRun(agentStep).review(refOf(1), { holder });

    expect(ticketFacts().sessions).toEqual({
      steps: [
        {
          agent: "review",
          sessionId: "review-session",
          account: 2,
          configFolder: "/config/account-1",
        },
        {
          agent: "resolve",
          sessionId: "resolve-session",
          account: 1,
          configFolder: "/config/account-1",
        },
      ],
    });
  });

  it("records a halted review's sessions under the runner's config folder when no implement session was recorded", async () => {
    const agentStep = FakeAgentStep.init(
      { ...reviewed(findings.slice(0, 1)), sessionId: "review-session" },
      async (request) => ({
        ...(await resolvedAs(halt)(request)),
        sessionId: "resolve-session",
      }),
    );

    const result = await specRun(agentStep).review(refOf(1), { holder });

    expect(result.kind).toBe("halted");
    const accountOne = { account: 1, configFolder: "/config/account-1" };
    expect(ticketFacts().sessions).toEqual({
      steps: [
        { agent: "review", sessionId: "review-session", ...accountOne },
        { agent: "resolve", sessionId: "resolve-session", ...accountOne },
      ],
    });
  });

  it("prints its message once, at the head of its printout, and records it in the progress log", async () => {
    const logged: string[] = [];

    const result = await specRun(reviewsWithFix(), {
      log: (line) => logged.push(line),
    }).review(refOf(1), { holder });

    expect(logged).not.toContain(result.message);
    expect(reviewPrintoutOf(result).startsWith(result.message)).toBe(true);
    expect(progressLines().at(-1)).toContain(result.message);
  });

  it("finds its markers on a second review and posts no note or review list twice", async () => {
    await specRun(reviewsWithFix()).review(refOf(1), { holder });

    const result = await specRun(reviewsWithFix("fix-again.ts")).review(
      refOf(1),
      { holder },
    );

    expect(result.kind).toBe("reviewed");
    expect(commentsOn(2, "byro-repo#1's review left this")).toHaveLength(1);
    expect(commentsOn(213, "<!-- review-list ticket=#1 -->")).toHaveLength(1);
  });

  it("edits nothing on a second review whose list is the posted one", async () => {
    await specRun(reviewsWithFix()).review(refOf(1), { holder });
    const [posted] = commentsOn(213, "<!-- review-list ticket=#1 -->");

    await specRun(reviewsWithFix("fix-again.ts")).review(refOf(1), { holder });

    expect(commentsOn(213, "<!-- review-list ticket=#1 -->")).toEqual([posted]);
  });

  describe("a second review whose list differs", () => {
    const newPropose: ResolveRecord = {
      ...base(4),
      verdict: "propose",
      reason: "decision",
      recommendation: "Pick the fourth.",
    };

    async function reviewTwice(
      decision: Omit<ItemDecision, "itemId">,
      ...records: ResolveRecord[]
    ): Promise<string> {
      await specRun(reviewsWithFix()).review(refOf(1), { holder });
      await specRun(FakeAgentStep.init()).decide(spec, {
        itemId: "R1.1",
        ...decision,
      });
      const hasFix = records.some(({ verdict }) => verdict === "fix");
      await specRun(
        FakeAgentStep.init(
          reviewed(records.map(({ finding }) => findingOf(finding))),
          resolved(records, hasFix ? "fix-again.ts" : undefined),
        ),
      ).review(refOf(1), { holder });
      const lists = commentsOn(213, "<!-- review-list ticket=#1 -->");
      expect(lists).toHaveLength(1);
      return lists[0] ?? "";
    }

    it("edits the posted list in place, keeping a decided item and adding the new Propose after it, undecided", async () => {
      const list = await reviewTwice(
        { kind: "decided", text: "fixed in session · abc123" },
        propose,
        fix,
        coveredLater,
        newPropose,
      );

      expect(list).toContain(
        "- [x] **R1.1** · Propose `decision` · Finding 1: Line 1 is wrong. (one.ts:1)\n  suggested Fix → Propose: Checked it.\n  Recommendation: Pick the first.\n  Decided: fixed in session · abc123",
      );
      expect(list).toContain(
        "- [ ] **R1.2** · Propose `decision` · Finding 4: Line 4 is wrong. (one.ts:4)\n  suggested Fix → Propose: Checked it.\n  Recommendation: Pick the fourth.",
      );
      expect(list.match(/Finding 1: Line 1 is wrong/g)).toHaveLength(1);
      expect(list.indexOf("**R1.1**")).toBeLessThan(list.indexOf("**R1.2**"));
    });

    it("keeps a handled item the re-review no longer raises, and takes its other sections from the new review", async () => {
      const fixOf = (finding: number): ResolveRecord => ({
        ...fix,
        ...base(finding),
      });

      const list = await reviewTwice(
        { kind: "handled", text: "half done" },
        fixOf(1),
        fixOf(2),
        fixOf(3),
        newPropose,
      );

      expect(list).toBe(
        [
          "<!-- spec-runner -->\n<!-- review-list ticket=#1 -->",
          '**Review list** · byro-repo #1, "Ticket 1"',
          "### Standards",
          "**Fixed**\n\n- Finding 1: Line 1 is wrong. (one.ts:1)\n- Finding 2: Line 2 is wrong. (one.ts:2)\n- Finding 3: Line 3 is wrong. (one.ts:3)",
          "### Proposed",
          "- [ ] **R1.1** · Propose `decision` · Finding 1: Line 1 is wrong. (one.ts:1)\n  suggested Fix → Propose: Checked it.\n  Recommendation: Pick the first.\n  Handled: half done\n- [ ] **R1.2** · Propose `decision` · Finding 4: Line 4 is wrong. (one.ts:4)\n  suggested Fix → Propose: Checked it.\n  Recommendation: Pick the fourth.",
        ].join("\n\n"),
      );
    });
  });

  it("posts no second list where the ticket's runner-marked list is someone else's, and edits none", async () => {
    const theirs = `<!-- spec-runner -->\n<!-- review-list ticket=#1 -->\n\n**Review list** · byro-repo #1, "Ticket 1"`;
    github.reply(213, theirs, "someone-else");

    await specRun(reviewsWithFix()).review(refOf(1), { holder });

    expect(commentsOn(213, "<!-- review-list ticket=#1 -->")).toEqual([theirs]);
  });

  it("pushes nothing for its review list under the per-ticket cadence", async () => {
    const knobs = runKnobsOf({
      clonePaths,
      checks: [greenUnlessRed],
      authChecks: [passes],
      reviewListCadence: "per-ticket",
    });

    await specRun(reviewsWithFix(), { knobs }).review(refOf(1), { holder });

    expect(commentsOn(213, "<!-- review-list ticket=#1 -->")).toHaveLength(1);
    expect(notices.sent).toEqual([]);
  });

  it("leaves a later run that lands the ticket to find its review list and post none twice, editing none though its own list differs", async () => {
    const reviewing = specRun(reviewsWithFix());
    await reviewing.review(refOf(1), { holder });
    const workspace = await reviewing.workspaces.find(refOf(1));
    if (workspace) await reviewing.workspaces.releaseLease(workspace);
    const posted = commentsOn(213, "<!-- review-list ticket=#1 -->");
    const reworded = { ...propose, recommendation: "Pick the second." };

    const result = await specRun(
      FakeAgentStep.init(
        implemented("two.ts"),
        reviewed(findings),
        resolved([reworded, fix, coveredLater], "fix-again.ts"),
        implemented("three.ts"),
        reviewed(findings.slice(0, 1)),
        resolvedAs(halt),
      ),
    ).run(spec);

    expect(result.landed).toEqual([refOf(1)]);
    expect(commentsOn(213, "<!-- review-list ticket=#1 -->")).toEqual(posted);
  });

  it("posts a Halt verdict on the spec as a session Halt, returns it to print and pushes nothing", async () => {
    const agentStep = FakeAgentStep.init(
      reviewed(findings.slice(0, 1)),
      resolvedAs(halt),
    );

    const result = await specRun(agentStep).review(refOf(1), { holder });

    expect(result.kind).toBe("halted");
    expect(result.message).toContain("halted on Halt S1.1");
    const halts = commentsOn(213, "**Halt S1.1**");
    expect(halts).toHaveLength(1);
    expect(result.halts).toHaveLength(1);
    expect(halts[0]).toContain(result.halts[0]);
    expect(result.halts[0]).toContain(
      '**Halt S1.1** · Halt 1 of 1 · byro-repo #1, "Ticket 1" · verdict Halt',
    );
    expect(result.halts[0]).toContain("Options:\n1. Answer it.\n\n");
    expect(result.halts[0]).not.toContain("stop spec");
    expect(notices.sent).toEqual([]);
    expect(ticketFacts()).toMatchObject({
      reviewFixes: "none",
      whatReviewCaught: "Halted: Line 1 is wrong. (one.ts:1).",
      proposals: 0,
    });
  });

  it("prints a halted review's list before its Halt, posting the list nowhere", async () => {
    const agentStep = FakeAgentStep.init(
      reviewed(findings.slice(0, 1)),
      resolvedAs(halt),
    );

    const result = await specRun(agentStep).review(refOf(1), { holder });

    expect(result.kind).toBe("halted");
    expect(commentsOn(213, "<!-- review-list ")).toEqual([]);
    expect(reviewPrintoutOf(result)).toBe(
      [
        result.message,
        "<!-- review-list ticket=#1 -->",
        '**Review list** · byro-repo #1, "Ticket 1"',
        "### Standards",
        "**Halted**\n\n- Finding 1: Line 1 is wrong. (one.ts:1)\n  suggested Fix → Halt: Checked it.\n  Recommendation: Answer it.",
        ...result.halts,
      ].join("\n\n"),
    );
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
      FakeAgentStep.init(reviewed(findings.slice(0, 1)), resolvedAs(halt)),
    );
    await reviewing.review(refOf(1), { holder });
    expect(existsSync(runStatePath())).toBe(false);
    const workspace = await reviewing.workspaces.find(refOf(1));
    if (workspace) await reviewing.workspaces.releaseLease(workspace);
    await specRun(
      FakeAgentStep.init(
        implemented("two.ts"),
        reviewed(findings.slice(0, 1)),
        resolvedAs(halt),
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

  it("refuses a workspace with uncommitted changes, which the resolve step could reset away", async () => {
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

  it("launches the review and a fresh resolver each on the account active just before it", async () => {
    let activeAccount = 1;
    const usageReader: UsageReader = {
      read: async () => usageListOf(0.1, 0.2, activeAccount),
    };
    const agentStep = FakeAgentStep.init(
      async () => {
        activeAccount = 2;
        return reviewed(findings);
      },
      resolved([propose, fix, coveredLater], "fix.ts"),
    );

    const result = await specRun(agentStep, { usageReader }).review(refOf(1), {
      holder,
    });

    expect(result.kind).toBe("reviewed");
    expect(agentStep.requests.map(({ account }) => account)).toEqual([1, 2]);
  });

  it("refuses with a message naming cswap when cswap reports no active account, launching nothing", async () => {
    const usageReader: UsageReader = {
      read: async () => ({
        ...usageListOf(0.1, 0.2),
        activeAccount: undefined,
      }),
    };
    const agentStep = FakeAgentStep.init(reviewed());

    const result = await specRun(agentStep, { usageReader }).review(refOf(1), {
      holder,
    });

    expect(result.kind).toBe("refused");
    expect(result.message).toContain("cswap");
    expect(agentStep.requests).toHaveLength(0);
  });

  it("numbers a later review's Halts on from the ticket's earlier ones, so no two share an id", async () => {
    function halting(): FakeAgentStep {
      return FakeAgentStep.init(
        reviewed(findings.slice(0, 1)),
        resolvedAs(halt),
      );
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
