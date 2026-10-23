import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { beforeEach, describe, expect, it } from "vitest";

import { FactsFile } from "./FactsFile.ts";
import { FakeAgentStep } from "./FakeAgentStep.ts";
import { git } from "./GitFixture.ts";
import type { LeaseHolder, Workspace } from "./IssueWorkspaces.ts";
import type { ResolveRecord } from "./resolveStep.ts";
import { reviewPrintoutOf } from "./SpecRun.ts";
import {
  addSpec,
  findingOf,
  github,
  refOf,
  resolved,
  reviewed,
  specRun,
  stateFolder,
  ticketFacts,
  useSpecRunHarness,
} from "./specRunHarness.ts";

useSpecRunHarness();

describe("a session resolving its own review", () => {
  const holder: LeaseHolder = { kind: "session", pid: process.ppid };
  let workspace: Workspace;

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

  // The interactive implement session, recorded as issue:start records it, with a transcript peaking at `peak`.
  function implementedAt(peak: number): void {
    const configFolder = join(stateFolder(), "config");
    const projectDir = join(configFolder, "projects", "-workspace");
    mkdirSync(projectDir, { recursive: true });
    const entry = {
      type: "assistant",
      message: { id: "m1", usage: { input_tokens: peak } },
    };
    writeFileSync(
      join(projectDir, "implement-session.jsonl"),
      `${JSON.stringify(entry)}\n`,
    );
    FactsFile.init(stateFolder()).addSession(refOf(1), {
      account: 2,
      configFolder,
      step: { agent: "implement", sessionId: "implement-session" },
    });
  }

  const findings = [
    findingOf(1),
    findingOf(2, "spec", "halt"),
    findingOf(3, "spec", "dismiss"),
  ];

  function base(finding: number): Omit<ResolveRecord, "verdict" | "axis"> {
    return {
      finding,
      where: `one.ts:${finding}`,
      claim: `Line ${finding} is wrong.`,
      evidence: "Checked it.",
    };
  }

  const fix: ResolveRecord = {
    ...base(1),
    axis: "standards",
    verdict: "fix",
    quote: "one.ts:1 `export {};`",
    rule: "config/docs/code-style.md: a rule.",
  };
  const decision: ResolveRecord = {
    ...base(2),
    axis: "spec",
    verdict: "propose",
    reason: "decision",
    recommendation: "Read it the second way.",
  };
  const coveredLater: ResolveRecord = {
    ...base(3),
    axis: "spec",
    verdict: "dismiss",
    reason: "covered-later",
    coveredBy: "byro-repo#2",
  };

  async function reviewUnderBudget(): Promise<FakeAgentStep> {
    implementedAt(100_000);
    const agentStep = FakeAgentStep.init({
      ...reviewed(findings),
      sessionId: "review-session",
    });
    await specRun(agentStep).review(refOf(1), { holder });
    return agentStep;
  }

  it("starts only the review session under the ticket budget, records it, and returns the findings with their axes and suggested verdicts", async () => {
    implementedAt(100_000);
    const agentStep = FakeAgentStep.init({
      ...reviewed(findings),
      sessionId: "review-session",
    });

    const result = await specRun(agentStep).review(refOf(1), { holder });

    expect(result.kind).toBe("findings");
    expect(agentStep.requests).toHaveLength(1);
    expect(reviewPrintoutOf(result)).toBe(
      [
        "Reviewed byro-repo #1, findings: 3. Resolve them in this session by `docs/agents/verdicts.md`, then hand your records to resolve.",
        [
          "1. [standards] one.ts:1: Line 1 is wrong. Suggested verdict: fix, It breaks a rule.",
          "2. [spec] one.ts:2: Line 2 is wrong. Suggested verdict: halt, It breaks a rule.",
          "3. [spec] one.ts:3: Line 3 is wrong. Suggested verdict: dismiss, It breaks a rule.",
        ].join("\n"),
      ].join("\n\n"),
    );
    expect(ticketFacts().sessions?.steps).toEqual([
      { agent: "implement", sessionId: "implement-session" },
      { agent: "review", sessionId: "review-session" },
    ]);
    expect(ticketFacts().reviewFixes).toBeUndefined();
  });

  it("keeps records that pass the run's checker, printing them through the run's review list and writing the review facts", async () => {
    await reviewUnderBudget();
    commit("fix.ts");

    const result = await specRun(FakeAgentStep.init()).resolve(refOf(1), {
      holder,
      output: { records: [fix, decision, coveredLater] },
    });

    expect(result.kind).toBe("reviewed");
    expect(result.reviewList).toContain("<!-- review-list ticket=#1 -->");
    expect(result.reviewList).toContain(
      "suggested Halt → Propose: Checked it.",
    );
    expect(reviewPrintoutOf(result)).toBe(
      [result.message, result.reviewList].join("\n\n"),
    );
    expect(ticketFacts()).toMatchObject({
      reviewFixes: "implementer",
      proposals: 1,
    });
    expect(ticketFacts().pendingResolve).toBeUndefined();
    const notes = github.comments.filter(
      ({ issue, body }) =>
        issue.number === 2 && body.includes("byro-repo#1's review left this"),
    );
    expect(notes).toHaveLength(1);
  });

  it("refuses a suggested Halt resolved as a Fix, naming the rule, and keeps the findings for a corrected resolve", async () => {
    await reviewUnderBudget();
    commit("fix.ts");
    const resolving = specRun(FakeAgentStep.init());

    const refused = await resolving.resolve(refOf(1), {
      holder,
      output: {
        records: [fix, { ...decision, ...fix, finding: 2 }, coveredLater],
      },
    });

    expect(refused.kind).toBe("refused");
    expect(refused.message).toContain(
      "- finding 2: a suggested Halt resolves only as a Halt or a Propose `decision`",
    );
    const corrected = await resolving.resolve(refOf(1), {
      holder,
      output: { records: [fix, decision, coveredLater] },
    });
    expect(corrected.kind).toBe("reviewed");
  });

  it("refuses a Fix the session didn't commit, as a run's resolve would", async () => {
    await reviewUnderBudget();

    const result = await specRun(FakeAgentStep.init()).resolve(refOf(1), {
      holder,
      output: { records: [fix, decision, coveredLater] },
    });

    expect(result.kind).toBe("refused");
    expect(result.message).toContain(
      "- the records give a Fix, but the step committed no change",
    );
  });

  it("refuses records missing a field the rules read, naming it", async () => {
    await reviewUnderBudget();

    const result = await specRun(FakeAgentStep.init()).resolve(refOf(1), {
      holder,
      output: { records: [{ finding: 1, verdict: "mend" }] },
    });

    expect(result.kind).toBe("refused");
    expect(result.message).toContain(
      "- /records/0/verdict must be equal to one of the allowed values",
    );
  });

  it("posts the session's Halt verdict as a session Halt to answer in the session", async () => {
    await reviewUnderBudget();
    commit("fix.ts");
    const halt: ResolveRecord = {
      ...base(2),
      axis: "spec",
      verdict: "halt",
      recommendation: "Answer it.",
    };

    const result = await specRun(FakeAgentStep.init()).resolve(refOf(1), {
      holder,
      output: { records: [fix, halt, coveredLater] },
    });

    expect(result.kind).toBe("halted");
    expect(result.message).toContain("halted on Halt S1.1");
    expect(result.halts[0]).toContain("**Halt S1.1**");
  });

  it("refuses a resolve with no review waiting on it", async () => {
    const result = await specRun(FakeAgentStep.init()).resolve(refOf(1), {
      holder,
      output: { records: [] },
    });

    expect(result).toEqual({
      kind: "refused",
      message:
        "byro-repo #1 has no findings waiting on this session; run review first.",
      halts: [],
    });
  });

  it("starts a fresh resolver past the ticket budget and records it", async () => {
    implementedAt(160_000);
    const agentStep = FakeAgentStep.init(
      { ...reviewed(findings), sessionId: "review-session" },
      async (request) => ({
        ...(await resolved([fix, decision, coveredLater], "fix.ts")(request)),
        sessionId: "resolve-session",
      }),
    );

    const result = await specRun(agentStep).review(refOf(1), { holder });

    expect(result.kind).toBe("reviewed");
    expect(ticketFacts().reviewFixes).toBe("fresh");
    expect(ticketFacts().sessions?.steps).toEqual([
      { agent: "implement", sessionId: "implement-session" },
      { agent: "review", sessionId: "review-session" },
      { agent: "resolve", sessionId: "resolve-session" },
    ]);
  });
});
