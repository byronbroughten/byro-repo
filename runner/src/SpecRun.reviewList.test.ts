import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import type { Pair } from "./AgentStep.ts";
import { FakeAgentStep } from "./FakeAgentStep.ts";
import type { TriageRecord } from "./findingTriage.ts";
import { gapCheckOutputSchema } from "./gapCheck.ts";
import { runKnobsOf } from "./runKnobs.ts";
import {
  addSpec,
  clonePaths,
  github,
  greenUnlessRed,
  implemented,
  notices,
  passes,
  primaryRoot,
  resultOf,
  reviewed,
  spec,
  specRun,
  stateFolder,
  useSpecRunHarness,
} from "./specRunHarness.ts";

useSpecRunHarness();

describe("run's review list", () => {
  const opusMedium: Pair = { model: "opus", effort: "medium" };
  const findings = [
    "one.ts:1 is wrong.",
    "one.ts:2 is wrong.",
    "one.ts:3 is wrong.",
  ];

  function base(finding: number): Omit<TriageRecord, "verdict"> {
    return {
      finding,
      axis: "standards",
      where: `one.ts:${finding}`,
      claim: `Line ${finding} is wrong.`,
      evidence: "Checked it.",
    };
  }

  const defer: TriageRecord = {
    ...base(1),
    verdict: "defer",
    reason: "decision",
    recommendation: "Pick the first.",
  };
  const kept: TriageRecord = {
    ...base(2),
    verdict: "dismiss",
    reason: "kept",
    quote: "one.ts:2 `// Kept for the old reader.`",
  };
  const coveredLater: TriageRecord = {
    ...base(3),
    verdict: "dismiss",
    reason: "covered-later",
    coveredBy: "byro-repo#2",
  };
  const halt: TriageRecord = {
    ...base(2),
    verdict: "halt",
    recommendation: "Answer it.",
  };

  function triaged(...records: TriageRecord[]) {
    return resultOf({ records });
  }

  function reviewListsOn(number: number): string[] {
    return github.comments
      .filter(({ issue }) => issue.number === number)
      .map(({ body }) => body)
      .filter((body) => body.includes("<!-- review-list "));
  }

  function clearPostedFlags(): void {
    const path = join(stateFolder(), "byro-repo-213.run.json");
    const state = JSON.parse(readFileSync(path, "utf8")) as {
      tickets: Record<string, { isReviewListPosted?: boolean }>;
    };
    for (const ticket of Object.values(state.tickets)) {
      delete ticket.isReviewListPosted;
    }
    writeFileSync(path, JSON.stringify(state));
  }

  function landsOneWithDefer(): FakeAgentStep {
    return FakeAgentStep.init(
      implemented("one.ts"),
      reviewed(findings),
      triaged(defer, kept, coveredLater),
      implemented("two.ts"),
      reviewed(),
    );
  }

  it("posts a landed ticket's Defers as R items with a collapsed Dismiss audit, the kept quote included", async () => {
    addSpec([1, 2]);

    await specRun(landsOneWithDefer()).run(spec);

    const [list, gapCheck] = reviewListsOn(213);
    expect(reviewListsOn(213)).toHaveLength(2);
    expect(list).toContain("<!-- review-list ticket=#1 -->");
    expect(list).toContain(
      "- [ ] **R1.1** · Defer `decision` · Finding 1: Line 1 is wrong. (one.ts:1)\n  Evidence: Checked it.\n  Recommendation: Pick the first.",
    );
    expect(list).toContain("<details>\n<summary>Dismissed: 2</summary>");
    expect(list).toContain("Kept for: one.ts:2 `// Kept for the old reader.`");
    expect(list).toContain("Covered by byro-repo#2.");
    expect(list?.match(/- \[ \]/g)).toHaveLength(1);
    expect(gapCheck).toContain("<!-- review-list ticket=gap-check -->");
  });

  it("posts no review list for a ticket with no Defers", async () => {
    addSpec([1]);
    const agentStep = FakeAgentStep.init(
      implemented("one.ts"),
      reviewed(findings.slice(1, 2)),
      triaged({ ...kept, finding: 1 }),
    );

    await specRun(agentStep).run(spec);

    expect(reviewListsOn(213)).toEqual([
      expect.stringContaining("ticket=gap-check"),
    ]);
  });

  it("leaves a covered-later Dismiss's note with its file:line on the named ticket", async () => {
    addSpec([1, 2]);

    await specRun(landsOneWithDefer()).run(spec);

    expect(reviewListsOn(2)).toEqual([
      expect.stringContaining(
        "byro-repo#1's review left this for this ticket to cover: Line 3 is wrong. (one.ts:3).",
      ),
    ]);
  });

  it("finds its markers on a rerun and posts nothing twice", async () => {
    addSpec([1, 2]);
    await specRun(landsOneWithDefer()).run(spec);
    clearPostedFlags();
    const agentStep = FakeAgentStep.init();

    await specRun(agentStep, { agentStep }).run(spec);

    expect(agentStep.requests).toHaveLength(0);
    expect(reviewListsOn(213)).toHaveLength(2);
    expect(reviewListsOn(2)).toHaveLength(1);
  });

  it("posts a Halted then passed ticket's list once it lands, covering the Defers from before the Halt", async () => {
    addSpec([1]);
    await specRun(
      FakeAgentStep.init(
        implemented("one.ts"),
        reviewed(findings.slice(0, 2)),
        triaged(defer, halt),
      ),
    ).run(spec);
    expect(reviewListsOn(213)).toEqual([]);
    github.reply(213, "H1: read it the first way.");

    await specRun(FakeAgentStep.init(implemented("fix.ts"))).run(spec);

    const [list] = reviewListsOn(213);
    expect(list).toContain("**R1.1** · Defer `decision` · Finding 1");
    expect(list).not.toContain("R1.2");
  });

  it("runs the gap check with no targets on its pair once every ticket closes, posting its gaps as the last review list", async () => {
    addSpec([1]);
    const agentStep = FakeAgentStep.init(
      implemented("one.ts"),
      reviewed(),
      resultOf({
        gaps: [
          {
            ask: "Story 4",
            evidence: "No code reads the knob.",
            recommendation: "File the follow-up.",
            draftIssueTitle: "Read the knob",
          },
        ],
      }),
    );

    await specRun(agentStep, { agentStep }).run(spec);

    const gapCheck = agentStep.requests[2];
    expect(gapCheck?.jsonSchema).toBe(gapCheckOutputSchema);
    expect(gapCheck?.targets).toEqual([]);
    expect(gapCheck?.allowedWriteGlobs).toEqual([]);
    expect(gapCheck?.pair).toEqual(opusMedium);
    expect(gapCheck?.cwd).toBe(primaryRoot);
    expect(gapCheck?.prompt).toContain('- byro-repo #1, "Ticket 1"');
    expect(reviewListsOn(213)).toEqual([
      expect.stringContaining(
        '<!-- review-list ticket=gap-check -->\n\n**Review list** · gap check, "The spec"\n\n- [ ] **Rgap-check.1** · Gap · Story 4\n  Evidence: No code reads the knob.\n  Recommendation: File the follow-up.\n  Drafted issue: "Read the knob"',
      ),
    ]);
  });

  it("holds the gap check while a ticket is still open", async () => {
    addSpec([1, 2]);
    const agentStep = FakeAgentStep.init(
      implemented("one.ts"),
      reviewed(findings.slice(0, 2)),
      triaged(defer, { ...halt, haltScope: ["byro-repo#2"] }),
    );

    await specRun(agentStep, { agentStep }).run(spec);

    expect(agentStep.requests).toHaveLength(3);
    expect(reviewListsOn(213)).toEqual([]);
  });

  it("ends a finished run with one push counting the undecided items across tickets", async () => {
    addSpec([1, 2]);

    await specRun(landsOneWithDefer()).run(spec);

    expect(notices.sent.at(-1)?.summary).toBe(
      "Run ended: landed byro-repo #1, byro-repo #2. Every ticket is closed. review list: 1 undecided across 1 ticket.",
    );
  });

  it("pushes per ticket instead under the per-ticket cadence", async () => {
    addSpec([1, 2]);
    const knobs = runKnobsOf({
      clonePaths,
      checks: [greenUnlessRed],
      authChecks: [passes],
      reviewListCadence: "per-ticket",
    });

    await specRun(landsOneWithDefer(), { knobs }).run(spec);

    const summaries = notices.sent.map(({ summary }) => summary);
    expect(summaries).toContain("review list: 1 undecided on byro-repo #1");
    expect(summaries.at(-1)).toBe(
      "Run ended: landed byro-repo #1, byro-repo #2. Every ticket is closed.",
    );
  });
});
