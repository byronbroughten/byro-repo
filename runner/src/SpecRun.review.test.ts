import { existsSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { beforeEach, describe, expect, it } from "vitest";

import { FactsFile } from "./FactsFile.ts";
import { FakeAgentStep } from "./FakeAgentStep.ts";
import { git } from "./GitFixture.ts";
import type { LeaseHolder, Workspace } from "./IssueWorkspaces.ts";
import type { UsageReader } from "./limitGuard.ts";
import type { ItemDecision } from "./reviewList.ts";
import { runKnobsOf } from "./runKnobs.ts";
import { reviewPrintoutOf } from "./SpecRun.ts";
import type { ReviewResult } from "./SpecRun/runState.ts";
import {
  addIssue,
  addSpec,
  clonePaths,
  commentsOn,
  crashed,
  findingOf,
  github,
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
  type SpecRunOverrides,
  stateFolder,
  type StepScript,
  ticketFacts,
  usageListOf,
  useSpecRunHarness,
} from "./specRunHarness.ts";
import type { ResolveRecord } from "./stepRecords.ts";

useSpecRunHarness();

describe("review of one ticket outside a run", () => {
  const holder: LeaseHolder = { kind: "session", pid: process.ppid };
  let workspace: Workspace;

  // An interactive session's workspace, with its work committed and its lease held.
  beforeEach(async () => {
    addSpec([1, 2]);
    const { workspaces } = specRun(FakeAgentStep.init());
    workspace = await workspaces.create(refOf(1));
    commit("one.ts");
    await workspaces.takeLease(workspace, holder);
  });

  function commit(file: string): void {
    writeFileSync(join(workspace.path, file), "export {};\n");
    git(workspace.path, "add", file);
    git(workspace.path, "commit", "-m", `Add ${file}`);
  }

  async function releaseLease(): Promise<void> {
    await specRun(FakeAgentStep.init()).workspaces.releaseLease(workspace);
  }

  const findings = [
    findingOf({ line: 1 }),
    findingOf({ line: 2 }),
    findingOf({ line: 3 }),
  ];

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

  interface SessionReview {
    review?: FakeAgentStep;
    fixFile?: string;
    overrides?: SpecRunOverrides;
  }

  // The session's review, by default one finding per record, then its own resolve of `records`, committing `fixFile` first when a record is a Fix.
  async function resolvedReview(
    records: ResolveRecord[],
    {
      review = FakeAgentStep.init(
        reviewed(records.map(({ finding }) => findingOf({ line: finding }))),
      ),
      fixFile = "fix.ts",
      overrides,
    }: SessionReview = {},
  ): Promise<ReviewResult> {
    await specRun(review, overrides).review(refOf(1), { holder });
    if (records.some(({ verdict }) => verdict === "fix")) commit(fixFile);
    return specRun(FakeAgentStep.init(), overrides).resolve(refOf(1), {
      holder,
      output: { records },
    });
  }

  const fixedReview = [propose, fix, coveredLater];

  it("reviews a code spec's ticket by the code Workflow", async () => {
    const agentStep = FakeAgentStep.init(reviewed());

    await specRun(agentStep).review(refOf(1), { holder });

    expect(agentStep.requests[0]?.prompt).not.toContain("review-piece");
  });

  it("reviews in a fresh review session of its own, since the session has no implementer session to resume", async () => {
    FactsFile.init(stateFolder()).addSession(refOf(1), {
      agent: "implement",
      sessionId: "implement-session",
      account: 1,
      configFolder: "/config/account-1",
    });
    const agentStep = FakeAgentStep.init(reviewed());

    await specRun(agentStep).review(refOf(1), { holder });

    const [review] = agentStep.requests;
    expect(review?.resumeSessionId).toBeUndefined();
    expect(review?.prompt).toContain("You are the review step");
    expect(review?.prompt).not.toContain("your own work");
    expect(review?.logPath).toMatch(/-review\.jsonl$/);
  });

  it("reviews a piece spec's ticket by the piece Workflow, as a run picks it", async () => {
    github.edit(spec.number, { labels: ["piece"] });
    const agentStep = FakeAgentStep.init(reviewed());

    await specRun(agentStep).review(refOf(1), { holder });

    expect(agentStep.requests[0]?.prompt).toContain(
      ".claude/skills/review-piece/SKILL.md",
    );
  });

  it("reviews a Standalone piece ticket by its own label", async () => {
    github.subIssues.set(spec.number, []);
    github.edit(1, { labels: ["ready-for-agent", "piece"] });
    const agentStep = FakeAgentStep.init(reviewed());

    await specRun(agentStep).review(refOf(1), { holder });

    expect(agentStep.requests[0]?.prompt).toContain(
      ".claude/skills/review-piece/SKILL.md",
    );
  });

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

  it("prints the run's review list and posts it on the spec, posts the covered-later note, and writes the same review facts", async () => {
    const result = await resolvedReview(fixedReview);

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
      reviewFixes: "implementer",
      whatReviewCaught:
        "Fixed: Line 2 is wrong. (one.ts:2). Proposed: Line 1 is wrong. (one.ts:1).",
      proposals: 1,
      hasUndecidedReviewItems: true,
    });
  });

  it("records the review session beside the implement session, under the account and config folder it ran as, and no session for the resolve", async () => {
    const implement = {
      agent: "implement",
      sessionId: "implement-session",
      account: 2,
      configFolder: "/config/account-2",
    } as const;
    FactsFile.init(stateFolder()).addSession(refOf(1), implement);
    const review = FakeAgentStep.init({
      ...reviewed(findings),
      sessionId: "review-session",
    });

    await resolvedReview(fixedReview, { review });

    expect(ticketFacts().sessions).toEqual({
      steps: [
        implement,
        {
          agent: "review",
          sessionId: "review-session",
          account: 1,
          configFolder: "/config/account-1",
        },
      ],
    });
  });

  it("records the review session under the account it ran as, in the runner's own config folder", async () => {
    const review = FakeAgentStep.init({
      ...reviewed(findings),
      sessionId: "review-session",
      account: 2,
    });

    await resolvedReview(fixedReview, { review });

    expect(ticketFacts().sessions).toEqual({
      steps: [
        {
          agent: "review",
          sessionId: "review-session",
          account: 2,
          configFolder: "/config/account-1",
        },
      ],
    });
  });

  it("records a halted review's session under the runner's config folder when no implement session was recorded", async () => {
    const review = FakeAgentStep.init({
      ...reviewed(findings.slice(0, 1)),
      sessionId: "review-session",
    });

    const result = await resolvedReview([halt], { review });

    expect(result.kind).toBe("halted");
    expect(ticketFacts().sessions).toEqual({
      steps: [
        {
          agent: "review",
          sessionId: "review-session",
          account: 1,
          configFolder: "/config/account-1",
        },
      ],
    });
  });

  it("prints its message once, at the head of its printout, and records it in the progress log", async () => {
    const logged: string[] = [];

    const result = await resolvedReview(fixedReview, {
      overrides: { log: (line) => logged.push(line) },
    });

    expect(logged).not.toContain(result.message);
    expect(reviewPrintoutOf(result).startsWith(result.message)).toBe(true);
    expect(progressLines().at(-1)).toContain(result.message);
  });

  it("finds its markers on a second review and posts no note or review list twice", async () => {
    await resolvedReview(fixedReview);

    const result = await resolvedReview(fixedReview, {
      fixFile: "fix-again.ts",
    });

    expect(result.kind).toBe("reviewed");
    expect(commentsOn(2, "byro-repo#1's review left this")).toHaveLength(1);
    expect(commentsOn(213, "<!-- review-list ticket=#1 -->")).toHaveLength(1);
  });

  it("edits nothing on a second review whose list is the posted one", async () => {
    await resolvedReview(fixedReview);
    const [posted] = commentsOn(213, "<!-- review-list ticket=#1 -->");

    await resolvedReview(fixedReview, { fixFile: "fix-again.ts" });

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
      await resolvedReview(fixedReview);
      await specRun(FakeAgentStep.init()).decide(spec, {
        itemId: "R1.1",
        ...decision,
      });
      await resolvedReview(records, { fixFile: "fix-again.ts" });
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

    await resolvedReview(fixedReview);

    expect(commentsOn(213, "<!-- review-list ticket=#1 -->")).toEqual([theirs]);
  });

  it("pushes nothing for its review list under the per-ticket cadence", async () => {
    const knobs = runKnobsOf({
      clonePaths,
      authChecks: [passes],
      reviewListCadence: "per-ticket",
    });

    await resolvedReview(fixedReview, { overrides: { knobs } });

    expect(commentsOn(213, "<!-- review-list ticket=#1 -->")).toHaveLength(1);
    expect(notices.sent).toEqual([]);
  });

  it("leaves a later run that lands the ticket to find its review list and post none twice, editing none though its own list differs", async () => {
    await resolvedReview(fixedReview);
    await releaseLease();
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
    const result = await resolvedReview([halt]);

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
    const result = await resolvedReview([halt]);

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
    await resolvedReview([halt]);
    expect(existsSync(runStatePath())).toBe(false);
    await releaseLease();
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

  it("refuses an interactive ticket with no Model fit, as a run's preflight does, launching nothing", async () => {
    addIssue(1, {
      labels: ["ready-for-interactive"],
      body: "## What to build\n\nA thing.\n",
    });
    const agentStep = FakeAgentStep.init(reviewed());

    const result = await specRun(agentStep).review(refOf(1), { holder });

    expect(result.kind).toBe("refused");
    expect(result.message).toBe(
      "byro-repo #1 has no valid ## Model fit section, so its review has no pair to run on: add one naming one of the six pairs.",
    );
    expect(agentStep.requests).toHaveLength(0);
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
    await resolvedReview([halt]);

    const result = await resolvedReview([halt]);

    expect(result.message).toContain("halted on Halt S1.2");
    expect(commentsOn(213, "**Halt S1.")).toEqual([
      expect.stringContaining("**Halt S1.1**"),
      expect.stringContaining("**Halt S1.2**"),
    ]);
  });
});
